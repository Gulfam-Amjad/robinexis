export { chunkText, type ChunkOptions, type TextChunk } from "./chunk.js";
export {
  GeminiEmbeddingProvider,
  l2Normalize,
  type EmbeddingProvider,
  type EmbeddingTaskType,
  type GeminiEmbeddingOptions,
} from "./gemini.js";
export {
  ingestMarkdown,
  ingestPdf,
  ingestSource,
  ingestText,
  type TextSource,
} from "./ingest.js";
export {
  KnowledgeService,
  createKnowledgeSearchCallback,
  type IndexKnowledgeInput,
} from "./service.js";
