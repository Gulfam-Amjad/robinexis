import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_INTENT_STORAGE,
  SELECTED_PLAN_STORAGE,
  readAuthIntent,
  safeReturnTo,
  saveAuthIntent,
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
});
