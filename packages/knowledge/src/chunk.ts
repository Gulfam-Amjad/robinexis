export interface TextChunk {
  index: number;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

/** Deterministic token approximation suitable for pre-embedding chunk boundaries. */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const target = Math.max(100, options.targetTokens ?? 800);
  const overlap = Math.max(0, Math.min(options.overlapTokens ?? 120, target - 1));
  const tokens = [...text.matchAll(/\S+/g)];
  if (!tokens.length) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < tokens.length) {
    const end = Math.min(start + target, tokens.length);
    const startOffset = tokens[start]!.index!;
    const finalToken = tokens[end - 1]!;
    const endOffset = finalToken.index! + finalToken[0].length;
    chunks.push({
      index: chunks.length,
      content: text.slice(startOffset, endOffset).trim(),
      tokenCount: end - start,
    });
    if (end === tokens.length) break;
    start = end - overlap;
  }
  return chunks;
}
