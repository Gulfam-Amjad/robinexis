import { describe, expect, it } from "vitest";
import {
  costSaverStartError,
  deriveReceptionistStatus,
  formatCallDuration,
  RECEPTIONIST_STATUS_COPY,
  receptionistStatusCopy,
  type LocalCallPhase,
  type VoiceConnectionStatus,
} from "./receptionistDemo.js";

function status(
  connection: VoiceConnectionStatus,
  phase: LocalCallPhase = "idle",
  options: { muted?: boolean; speaking?: boolean; error?: boolean } = {},
) {
  return deriveReceptionistStatus({
    connection,
    phase,
    isMuted: options.muted ?? false,
    isSpeaking: options.speaking ?? false,
    hasError: options.error ?? false,
  });
}

describe("branded receptionist state", () => {
  it("maps every call lifecycle state to clear interface copy", () => {
    expect(status("disconnected")).toBe("idle");
    expect(status("disconnected", "permission")).toBe("permission");
    expect(status("disconnected", "starting")).toBe("connecting");
    expect(status("connected")).toBe("listening");
    expect(status("connected", "idle", { speaking: true })).toBe("speaking");
    expect(status("connected", "idle", { speaking: true, muted: true })).toBe("muted");
    expect(status("disconnected", "ended")).toBe("ended");
    expect(status("error")).toBe("error");
    expect(status("disconnected", "idle", { error: true })).toBe("error");

    for (const item of Object.values(RECEPTIONIST_STATUS_COPY)) {
      expect(item.label.length).toBeGreaterThan(3);
      expect(item.detail.length).toBeGreaterThan(10);
    }
  });

  it("formats the live call timer", () => {
    expect(formatCallDuration(0)).toBe("00:00");
    expect(formatCallDuration(65)).toBe("01:05");
  });

  it("uses the active workspace names in generic call status", () => {
    expect(receptionistStatusCopy("listening", "Maya", "North Street Salon").label).toBe("Maya is listening");
    expect(receptionistStatusCopy("ended", "Maya", "North Street Salon").detail).toContain("North Street Salon");
  });

  it("explains Cost Saver start failures without leaking transport errors", () => {
    expect(costSaverStartError(new Error("Client initiated disconnect")))
      .toBe("We couldn't reach the Cost Saver voice runtime from this browser. Check the network, then try again.");
    expect(costSaverStartError(new DOMException("denied", "NotAllowedError")))
      .toContain("Microphone access was blocked");
    expect(costSaverStartError(new Error("cost_saver_runtime_not_configured")))
      .toBe("cost_saver_runtime_not_configured");
    expect(costSaverStartError(undefined)).toBe("The Cost Saver call could not be started.");
  });
});
