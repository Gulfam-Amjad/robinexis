import { describe, expect, it } from "vitest";
import {
  BLADES_HAIR_ID,
  DEMO_CLIENT_ID,
  MemoryStore,
  seedStore,
  type CallSession,
} from "@robinexis/database";
import type http from "node:http";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const salonActor: AuthenticatedActor = {
  subject: "user_salon",
  email: "owner@blades.test",
  role: "salon",
  clientRoles: { [BLADES_HAIR_ID]: "owner" },
};

const operatorActor: AuthenticatedActor = {
  subject: "user_operator",
  email: "operator@robinexis.test",
  role: "operator",
  clientRoles: {},
};

async function request(
  store: MemoryStore,
  actor: AuthenticatedActor,
  path: string,
) {
  let status = 0;
  let body: any;
  const url = new URL(path, "http://localhost");
  const handled = await handleProductRoute({
    req: { method: "GET" } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url,
    store,
    actor,
    readRaw: async () => Buffer.from(""),
    send: (_res, responseStatus, responseBody) => {
      status = responseStatus;
      body = responseBody;
    },
  });
  return { handled, status, body };
}

describe("product route tenant authorization", () => {
  it("limits salon users to assigned workspaces while operators see every tenant", async () => {
    const store = new MemoryStore();
    await seedStore(store);

    const salon = await request(store, salonActor, "/api/v1/clients");
    expect(salon.status).toBe(200);
    expect(salon.body.items.map((client: { id: string }) => client.id)).toEqual([BLADES_HAIR_ID]);

    const operator = await request(store, operatorActor, "/api/v1/clients");
    expect(operator.status).toBe(200);
    expect(operator.body.items.length).toBeGreaterThan(1);
  });

  it("returns not found instead of exposing another tenant or its calls", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const forbiddenClient = await request(store, salonActor, `/api/v1/clients/${DEMO_CLIENT_ID}`);
    expect(forbiddenClient).toMatchObject({ status: 404, body: { error: "client_not_found" } });

    const call: CallSession = {
      id: "call_other_tenant",
      clientId: DEMO_CLIENT_ID,
      direction: "inbound",
      objective: "test",
      promptVersionId: "prompt_test",
      transcript: [],
      collected: {},
      toolHistory: [],
      state: "complete",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveCall(call);

    const forbiddenCall = await request(store, salonActor, `/api/v1/calls/${call.id}`);
    expect(forbiddenCall).toMatchObject({ status: 404, body: { error: "call_not_found" } });
  });
});
