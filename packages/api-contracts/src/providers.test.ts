import { describe, expect, it } from "vitest";
import { resolveVoiceProvider } from "./index.js";

describe("voice provider contracts", () => {
  it("activates only the two supported providers", () => {
    expect(resolveVoiceProvider("elevenlabs-convai")).toMatchObject({ active: true, supported: true });
    expect(resolveVoiceProvider("livekit-cascade")).toMatchObject({ active: true, supported: true });
  });

  it("keeps legacy and unknown provider values fail-closed", () => {
    expect(resolveVoiceProvider("groq-gateway")).toEqual({
      active: false,
      supported: true,
      provider: "groq-gateway",
      reason: "provider_retired",
    });
    expect(resolveVoiceProvider("future-provider")).toEqual({
      active: false,
      supported: false,
      reason: "provider_unknown",
    });
    expect(resolveVoiceProvider(undefined).active).toBe(false);
  });
});
