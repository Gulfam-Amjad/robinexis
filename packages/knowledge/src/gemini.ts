export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbeddingProvider {
  embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]>;
  embedMany(texts: string[], taskType?: EmbeddingTaskType): Promise<number[][]>;
}

export interface GeminiEmbeddingOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: GeminiEmbeddingOptions) {
    if (!options.apiKey) throw new Error("gemini_api_key_required");
    this.model = options.model ?? "gemini-embedding-001";
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.request = options.fetch ?? globalThis.fetch;
  }

  async embed(text: string, taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT") {
    const modelPath = `models/${this.model}`;
    const response = await this.request(
      `${this.baseUrl}/${modelPath}:embedContent?key=${encodeURIComponent(this.options.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelPath,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: 768,
        }),
      },
    );
    const payload = (await response.json().catch(() => undefined)) as
      | { embedding?: { values?: number[] }; error?: { message?: string } }
      | undefined;
    if (!response.ok) {
      throw new Error(`gemini_embedding_failed:${response.status}:${payload?.error?.message ?? response.statusText}`);
    }
    const values = payload?.embedding?.values;
    if (!values || values.length !== 768) {
      throw new Error(`gemini_embedding_invalid_dimensions:${values?.length ?? 0}`);
    }
    return l2Normalize(values);
  }

  async embedMany(texts: string[], taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT") {
    return Promise.all(texts.map((text) => this.embed(text, taskType)));
  }
}

export function l2Normalize(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) throw new Error("embedding_has_zero_magnitude");
  return values.map((value) => value / magnitude);
}
