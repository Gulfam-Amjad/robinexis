import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_INTENT_STORAGE,
  SELECTED_PLAN_STORAGE,
  authErrorMessage,
  readAuthIntent,
  safeReturnTo,
  saveAuthIntent,
  sessionForCallback,
  selectedPlan,
  strayAuthCallback,
  validPlan,
} from "./supabase.js";

const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
});

beforeEach(() => values.clear());

describe("Supabase auth intent", () => {
  it("accepts only published signup plans", () => {
    expect(validPlan("starter")).toBe("starter");
    expect(validPlan("pro")).toBe("pro");
    expect(validPlan("enterprise")).toBeUndefined();
  });

  it("rejects external and recursive auth return paths", () => {
    expect(safeReturnTo("https://attacker.test")).toBe("/dashboard");
    expect(safeReturnTo("//attacker.test")).toBe("/dashboard");
    expect(safeReturnTo("/login?next=/admin")).toBe("/dashboard");
    expect(safeReturnTo("/app/calls")).toBe("/app/calls");
  });

  it("persists the selected plan across the provider redirect", () => {
    saveAuthIntent({ plan: "pro", returnTo: "/dashboard" });

    expect(readAuthIntent()).toEqual({ plan: "pro", returnTo: "/dashboard" });
    expect(selectedPlan()).toBe("pro");
    expect(values.has(AUTH_INTENT_STORAGE)).toBe(true);
    expect(values.get(SELECTED_PLAN_STORAGE)).toBe("pro");
  });

  it("exchanges a fresh callback code instead of reusing a stale session", async () => {
    const staleSession = { access_token: "stale-token" };
    const freshSession = { access_token: "fresh-token" };
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: staleSession }, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session: freshSession }, error: null }),
    } as unknown as Parameters<typeof sessionForCallback>[1];

    const session = await sessionForCallback("fresh-code", auth);

    expect(session?.access_token).toBe("fresh-token");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("fresh-code");
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("uses the persisted session only when no callback code is present", async () => {
    const persistedSession = { access_token: "persisted-token" };
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: persistedSession }, error: null }),
      exchangeCodeForSession: vi.fn(),
    } as unknown as Parameters<typeof sessionForCallback>[1];

    const session = await sessionForCallback(null, auth);

    expect(session?.access_token).toBe("persisted-token");
    expect(auth.getSession).toHaveBeenCalledOnce();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("Stray Supabase callback recovery", () => {
  it("forwards a code dropped on the Site URL to the callback", () => {
    expect(strayAuthCallback("/", "?code=abc123", "")).toBe("/auth/callback?code=abc123");
  });

  it("lifts a fragment provider error into the callback query", () => {
    expect(strayAuthCallback("/", "", "#error=access_denied&error_code=otp_expired")).toBe(
      "/auth/callback?error=access_denied&error_code=otp_expired",
    );
  });

  it("leaves the callback route itself alone so it is not a redirect loop", () => {
    expect(strayAuthCallback("/auth/callback", "?code=abc123", "")).toBeUndefined();
  });

  it("ignores ordinary routes and unrelated query parameters", () => {
    expect(strayAuthCallback("/signup", "?plan=pro", "")).toBeUndefined();
    expect(strayAuthCallback("/billing", "?checkout=success", "")).toBeUndefined();
    expect(strayAuthCallback("/demo/blades-hair", "", "")).toBeUndefined();
  });

  it("does not carry an implicit-flow access token into the query string", () => {
    expect(strayAuthCallback("/", "", "#access_token=leaky&token_type=bearer")).toBeUndefined();
  });
});

describe("Auth error messages", () => {
  it("explains an address the built-in mailer refuses to deliver to", () => {
    expect(authErrorMessage(new Error("Email address not authorized"), "fallback")).toContain(
      "Continue with Google",
    );
  });

  it("explains the project-wide email rate limit", () => {
    expect(authErrorMessage(new Error("email rate limit exceeded"), "fallback")).toContain(
      "Wait a few minutes",
    );
    expect(
      authErrorMessage(new Error("For security purposes, you can only request this after 51 seconds"), "fallback"),
    ).toContain("Wait a few minutes");
  });

  it("passes other Supabase messages through untouched", () => {
    expect(authErrorMessage(new Error("Signups not allowed for otp"), "fallback")).toBe(
      "Signups not allowed for otp",
    );
  });

  it("falls back when the failure carries no message", () => {
    expect(authErrorMessage(undefined, "The workspace could not be reached.")).toBe(
      "The workspace could not be reached.",
    );
    expect(authErrorMessage(new Error(""), "fallback")).toBe("fallback");
  });
});
