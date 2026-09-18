import { describe, expect, it } from "vitest";
import { ExclusiveVoiceSession } from "./exclusiveVoiceSession.js";

describe("ExclusiveVoiceSession", () => {
  it("grants one provider and rejects a competing start synchronously", () => {
    const session = new ExclusiveVoiceSession();
    expect(session.acquire("premium")).toBe(true);
    expect(session.acquire("cost-saver")).toBe(false);
    expect(session.current()).toBe("premium");
  });

  it("allows the same owner to reconnect and ignores stale releases", () => {
    const session = new ExclusiveVoiceSession();
    expect(session.acquire("cost-saver")).toBe(true);
    expect(session.acquire("cost-saver")).toBe(true);
    expect(session.release("premium")).toBe(false);
    expect(session.current()).toBe("cost-saver");
    expect(session.release("cost-saver")).toBe(true);
    expect(session.acquire("premium")).toBe(true);
  });
});
