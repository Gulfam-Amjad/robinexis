import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_KEY_STORAGE, api, formatDate, initials } from "./api.js";

const values = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});

describe("Robinexis API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("sends the active admin key and normalizes list responses", async () => {
    sessionStorage.setItem(API_KEY_STORAGE, "secret-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{ id: "client_1", slug: "demo", businessName: "Demo Salon", published: false, serviceStatus: "trialing" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const clients = await api.clients();

    expect(clients).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/clients$/), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer secret-key" }),
    }));
  });

  it("validates a proposed key without persisting it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ clients: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await api.validateKey("candidate-key");

    expect(sessionStorage.getItem(API_KEY_STORAGE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/bootstrap$/), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer candidate-key" }),
    }));
  });

  it("exposes useful API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "unauthorized",
      message: "Invalid workspace key",
    }), { status: 401, headers: { "Content-Type": "application/json" } }));

    await expect(api.validateKey("wrong-key")).rejects.toEqual(expect.objectContaining({
      message: "Invalid workspace key",
      status: 401,
    }));
  });
});

describe("format helpers", () => {
  it("creates readable initials", () => expect(initials("Smith England Salon")).toBe("SE"));
  it("does not break on invalid dates", () => expect(formatDate("not-a-date")).toBe("not-a-date"));
});
