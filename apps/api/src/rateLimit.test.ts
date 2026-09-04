import { afterEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clearRateLimitsForTest,
  limitForPath,
} from "./rateLimit.js";

afterEach(clearRateLimitsForTest);

describe("rate limiting", () => {
  it("blocks requests over the fixed-window limit without crossing keys", () => {
    expect(checkRateLimit("tenant-a", 2, 1_000, 100).allowed).toBe(true);
    expect(checkRateLimit("tenant-a", 2, 1_000, 101).allowed).toBe(true);
    expect(checkRateLimit("tenant-a", 2, 1_000, 102)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(checkRateLimit("tenant-b", 2, 1_000, 102).allowed).toBe(true);
  });

  it("resets expired windows", () => {
    expect(checkRateLimit("key", 1, 1_000, 100).allowed).toBe(true);
    expect(checkRateLimit("key", 1, 1_000, 101).allowed).toBe(false);
    expect(checkRateLimit("key", 1, 1_000, 1_100).allowed).toBe(true);
  });

  it("uses tighter limits for product and voice APIs", () => {
    expect(limitForPath("/api/v1/voice-tools/create-booking")).toBe(120);
    expect(limitForPath("/api/v1/clients")).toBe(240);
    expect(limitForPath("/webhooks/stripe")).toBe(600);
    expect(limitForPath("/health")).toBeUndefined();
  });
});
