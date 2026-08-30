import { createHash, randomUUID } from "node:crypto";
import type {
  KnowledgeDocument,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeSourceType,
  PlatformStore,
} from "@robinexis/database";
import { chunkText, type ChunkOptions } from "./chunk.js";
import type { EmbeddingProvider } from "./gemini.js";
import { ingestSource } from "./ingest.js";

export interface IndexKnowledgeInput {
  clientId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  content: string | Uint8Array;
  sourceUri?: string;
  metadata?: Record<string, unknown>;
  chunking?: ChunkOptions;
  pdfExtractor?: (pdf: Uint8Array) => Promise<string>;
}

export class KnowledgeService {
  constructor(
    private readonly store: PlatformStore,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async index(input: IndexKnowledgeInput): Promise<KnowledgeDocument> {
    if (!input.clientId.trim()) throw new Error("client_id_required");
    const now = new Date().toISOString();
    const document: KnowledgeDocument = {
      id: `kd_${randomUUID()}`,
      clientId: input.clientId,
      title: input.title,
      sourceType: input.sourceType,
      sourceUri: input.sourceUri,
      status: "pending",
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveKnowledgeDocument(document);

    try {
      const source = await ingestSource(input);
      const pieces = chunkText(source.text, input.chunking);
      if (!pieces.length) throw new Error("document_contains_no_text");
      const vectors = await this.embeddings.embedMany(
        pieces.map((piece) => piece.content),
        "RETRIEVAL_DOCUMENT",
      );
      await this.store.replaceKnowledgeChunks(
        input.clientId,
        document.id,
        pieces.map((piece, index) => ({
          id: `kc_${randomUUID()}`,
          clientId: input.clientId,
          documentId: document.id,
          chunkIndex: piece.index,
          content: piece.content,
          tokenCount: piece.tokenCount,
          embedding: vectors[index]!,
          metadata: input.metadata,
          createdAt: now,
        })),
      );
      document.status = "indexed";
      document.mimeType = source.mimeType;
      document.checksum = createHash("sha256").update(source.text).digest("hex");
      document.metadata = { ...document.metadata, chunkCount: pieces.length };
      document.updatedAt = new Date().toISOString();
      await this.store.saveKnowledgeDocument(document);
      return document;
    } catch (error) {
      document.status = "failed";
      document.error = error instanceof Error ? error.message : String(error);
      document.updatedAt = new Date().toISOString();
      await this.store.saveKnowledgeDocument(document);
      throw error;
    }
  }

  async search(
    clientId: string,
    query: string,
    options?: KnowledgeSearchOptions,
  ): Promise<KnowledgeSearchResult[]> {
    if (!clientId.trim()) throw new Error("client_id_required");
    if (!query.trim()) return [];
    const vector = await this.embeddings.embed(query, "RETRIEVAL_QUERY");
    return this.store.searchKnowledge(clientId, vector, options);
  }
}

export function createKnowledgeSearchCallback(service: KnowledgeService) {
  return (input: {
    clientId: string;
    query: string;
    limit?: number;
    minScore?: number;
    documentIds?: string[];
  }) => service.search(input.clientId, input.query, input);
}
