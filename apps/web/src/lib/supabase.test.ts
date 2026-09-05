import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_INTENT_STORAGE,
  SELECTED_PLAN_STORAGE,
  readAuthIntent,
  safeReturnTo,
  saveAuthIntent,
  sessionForCallback,
  selectedPlan,
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
