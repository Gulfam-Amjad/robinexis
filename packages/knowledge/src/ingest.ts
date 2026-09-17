import type { KnowledgeSourceType } from "@robinexis/database";

export interface TextSource {
  sourceType: KnowledgeSourceType;
  text: string;
  mimeType: string;
}

export function ingestText(input: string | Uint8Array): TextSource {
  return {
    sourceType: "txt",
    text: decode(input),
    mimeType: "text/plain",
  };
}

export function ingestMarkdown(input: string | Uint8Array): TextSource {
  return {
    sourceType: "markdown",
    text: decode(input),
    mimeType: "text/markdown",
  };
}

/**
 * Extracts text from simple text-based PDFs. Pass a production PDF extractor for
 * compressed, scanned, encrypted, or layout-heavy documents.
 */
export async function ingestPdf(
  input: Uint8Array,
  extractor?: (pdf: Uint8Array) => Promise<string>,
): Promise<TextSource> {
  const text = extractor ? await extractor(input) : extractBasicPdfText(input);
  if (!text.trim()) {
    throw new Error("pdf_text_extraction_failed: provide a PDF extractor or OCR adapter");
  }
  return { sourceType: "pdf", text, mimeType: "application/pdf" };
}

export async function ingestSource(input: {
  sourceType: KnowledgeSourceType;
  content: string | Uint8Array;
  pdfExtractor?: (pdf: Uint8Array) => Promise<string>;
}): Promise<TextSource> {
  if (input.sourceType === "markdown") return ingestMarkdown(input.content);
  if (input.sourceType === "txt") return ingestText(input.content);
  if (typeof input.content === "string") {
    throw new Error("pdf_content_must_be_binary");
  }
  return ingestPdf(input.content, input.pdfExtractor);
}

function decode(input: string | Uint8Array) {
  return typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);
}

function extractBasicPdfText(input: Uint8Array) {
  const raw = new TextDecoder("latin1").decode(input);
  const text: string[] = [];
  const pattern = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|['"])/g;
  for (const match of raw.matchAll(pattern)) {
    text.push(
      (match[1] ?? "")
        .replace(/\\([\\()])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\([0-7]{1,3})/g, (_, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        ),
    );
  }
  return text.join(" ").replace(/\s+/g, " ").trim();
}
