import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, redactSecrets, structuredLog } from "@robinexis/database";
import { enqueueLifecycleEmail, processNotificationDeliveries } from "./notificationQueue.js";
import { sendNotification } from "./notifications.js";

const base = new Date("2026-09-15T12:00:00.000Z");

describe("durable lifecycle notifications", () => {
  afterEach(() => {
    delete process.env.EMAIL_DELIVERY_MODE;
    vi.restoreAllMocks();
  });

  it("enqueues idempotently and keeps tenants isolated", async () => {
    const store = new MemoryStore();
    const input = {
      store, clientId: "tenant_a", operationId: "op_1", idempotencyKey: "payment:1",
      to: "owner@example.test", template: "Payment needs attention", now: base.toISOString(),
    };
    expect((await enqueueLifecycleEmail(input)).queued).toBe(true);
    expect((await enqueueLifecycleEmail(input)).queued).toBe(false);
    expect(await store.listNotifications("tenant_a")).toHaveLength(1);
    expect(await store.listNotifications("tenant_b")).toHaveLength(0);
  });

  it("retries with redacted errors then dead-letters at max attempts", async () => {
    const store = new MemoryStore();
    await enqueueLifecycleEmail({
      store, clientId: "tenant_a", operationId: "op_retry", idempotencyKey: "retry:1",
      to: "owner@example.test", template: "Test", now: base.toISOString(), maxAttempts: 2,
    });
    const fail = vi.fn().mockRejectedValue(new Error("Bearer secret-token owner@example.test"));
    expect(await processNotificationDeliveries({ store, workerId: "worker", now: base, send: fail }))
      .toEqual({ delivered: 0, retried: 1, deadLettered: 0 });
    const retryAt = new Date(base.getTime() + 5 * 60_000);
    expect(await processNotificationDeliveries({ store, workerId: "worker", now: retryAt, send: fail }))
      .toEqual({ delivered: 0, retried: 0, deadLettered: 1 });
    const [delivery] = await store.listNotifications("tenant_a");
    expect(delivery?.status).toBe("dead_letter");
    expect(delivery?.lastError).not.toContain("secret-token");
    expect(delivery?.lastError).not.toContain("owner@example.test");
  });

  it("captures log-mode email without network and records provider id", async () => {
    process.env.EMAIL_DELIVERY_MODE = "log";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sent = await sendNotification({
      channel: "email", to: "owner@example.test", template: "Setup complete\nReady.",
    });
    expect(sent.providerId).toMatch(/^captured_/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("redacts secrets and PII in structured fields", () => {
    expect(redactSecrets("Bearer abc owner@example.test +44 7700 900123"))
      .toBe("Bearer [redacted] [redacted-email] [redacted-phone]");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    structuredLog("test_event", { tenantId: "tenant_a", recipient: "owner@example.test" });
    expect(log.mock.calls[0]?.[0]).toContain('"tenantId":"tenant_a"');
    expect(log.mock.calls[0]?.[0]).not.toContain("owner@example.test");
  });
});
