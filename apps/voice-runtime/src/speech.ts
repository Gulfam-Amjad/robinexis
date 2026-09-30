export type SpeechProvider = "deepgram" | "elevenlabs";

export interface SpeechSelection {
  provider: SpeechProvider;
  fallbackReason?: string;
}

export function elevenLabsSpeechBlockReason(status: number, body: string): string | undefined {
  if (/payment_issue|payment_required|incomplete payment/i.test(body)) return "payment_issue";
  if (status === 402) return "payment_required";
  if (status === 401) return "unauthorized";
  return undefined;
}

export async function resolveSpeechProvider(input: {
  configured: SpeechProvider;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsTtsModel: string;
  fetchImpl?: typeof fetch;
}): Promise<SpeechSelection> {
  if (input.configured !== "elevenlabs") return { provider: "deepgram" };
  const fetchImpl = input.fetchImpl || fetch;
  try {
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.elevenLabsVoiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": input.elevenLabsApiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ text: "Hello.", model_id: input.elevenLabsTtsModel }),
      },
    );
    if (response.ok) {
      await response.arrayBuffer();
      return { provider: "elevenlabs" };
    }
    const reason = elevenLabsSpeechBlockReason(response.status, await response.text());
    if (reason) return { provider: "deepgram", fallbackReason: reason };
    return { provider: "elevenlabs" };
  } catch {
    return { provider: "elevenlabs" };
  }
}
