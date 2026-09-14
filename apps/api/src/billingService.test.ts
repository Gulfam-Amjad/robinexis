import { describe, expect, it } from "vitest";
import { MemoryStore } from "@robinexis/database";
import { ensureSelfServeWorkspace } from "./billingService.js";

describe("ensureSelfServeWorkspace", () => {
  it("creates one deterministic workspace during concurrent signup retries", async () => {
    const store = new MemoryStore();
    const actor = { subject: "auth-race", email: "owner+race@example.test" };
    const [first, second] = await Promise.all([
      ensureSelfServeWorkspace(store, actor, "starter"),
      ensureSelfServeWorkspace(store, actor, "starter"),
    ]);

    expect(first.id).toBe(second.id);
    expect((await store.listClients()).map((client) => client.id)).toEqual([first.id]);
    expect((await store.listMembershipsForEmail(actor.email))).toHaveLength(1);
    expect(first.calendar).toEqual({ provider: "calcom" });
    await expect(store.listCalendarConnections(first.id)).resolves.toEqual([
      expect.objectContaining({
        status: "pending",
        credentialRef: "CONNECTION_REQUIRED",
        metadata: { isolation: "connection_required" },
      }),
    ]);
  });

  it("maps duplicate identities for the same normalized email to one tenant", async () => {
    const store = new MemoryStore();
    const first = await ensureSelfServeWorkspace(
      store,
      { subject: "auth-one", email: "Owner@Example.test" },
      "starter",
    );
    const second = await ensureSelfServeWorkspace(
      store,
      { subject: "auth-two", email: "owner@example.test" },
      "pro",
    );

    expect(second.id).toBe(first.id);
    expect(await store.listClients()).toHaveLength(1);
  });
});
