import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryStore,
  robinexisDemoSeed,
  type PlatformStore,
} from "@robinexis/database";
import { resolveMinuteAccess, type MinuteAccessOptions } from "./minuteAccess.js";

const OVERAGE_PRICE_ID = "price_overage_100min";

async function stripeTenant(store: PlatformStore, id: string, optedIn = true) {
  const client = {
    ...robinexisDemoSeed(),
    id,
    slug: id,
    published: true,
    onboardingStatus: "active" as const,
    serviceStatus: "active" as const,
  };
  await store.upsertClient(client);
  await store.upsertSubscription({
    id: `sub_${id}`,
    clientId: id,
    provider: "stripe",
    providerCustomerId: `cus_${id}`,
    providerSubscriptionId: `stripe_sub_${id}`,
    planTier: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    metadata: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  if (optedIn) {
    await store.upsertTenantFeatureEntitlements({
      clientId: id,
      whatsappEnabled: false,
      autoMinuteBlocksEnabled: true,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  }
  return client;
}

async function consumeMinutes(store: PlatformStore, clientId: string, minutes: number, tag: string) {
  if (!minutes) return;
  await store.appendCreditLedgerEntry({
    id: `usage_${tag}`,
    clientId,
    minutes: -minutes,
    kind: "usage",
    referenceType: "test_usage",
    referenceId: tag,
    description: "test usage",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

type FakeInvoice = { id: string; status: string; items: Array<Record<string, unknown>> };

function fakeStripe(options: { paid?: boolean; price?: Record<string, unknown> | null } = {}) {
  const invoices = new Map<string, FakeInvoice>();
  const invoiceByKey = new Map<string, string>();
  const replies = new Map<string, unknown>();
  let paid = options.paid ?? true;
  let charges = 0;
  const price = options.price === undefined
    ? { active: true, unit_amount: 1_500, currency: "usd", recurring: null }
    : options.price;

  const retrievePrice = vi.fn(async (id: string) => {
    if (!price) throw new Error("No such price");
    return { id, ...price };
  });
  const createInvoice = vi.fn(async (
    _params: Record<string, unknown>,
    request?: { idempotencyKey?: string },
  ) => {
    const key = request?.idempotencyKey || "";
    const replayed = invoiceByKey.get(key);
    if (replayed) return { ...invoices.get(replayed)! };
    const invoice: FakeInvoice = { id: `in_${invoices.size + 1}`, status: "draft", items: [] };
    invoices.set(invoice.id, invoice);
    invoiceByKey.set(key, invoice.id);
    return { ...invoice };
  });
  const createItem = vi.fn(async (
    params: Record<string, unknown>,
    request?: { idempotencyKey?: string },
  ) => {
    const key = request?.idempotencyKey || "";
    if (replies.has(key)) return replies.get(key);
    invoices.get(String(params.invoice))?.items.push(params);
    const item = { id: `ii_${invoices.size}` };
    replies.set(key, item);
    return item;
  });
  const finalizeInvoice = vi.fn(async (
    id: string,
    _params: unknown,
    request?: { idempotencyKey?: string },
  ) => {
    const key = request?.idempotencyKey || "";
    if (replies.has(key)) return replies.get(key);
    const invoice = invoices.get(id)!;
    invoice.status = "open";
    const snapshot = { ...invoice };
    replies.set(key, snapshot);
    return snapshot;
  });
  const pay = vi.fn(async (
    id: string,
    _params: unknown,
    request?: { idempotencyKey?: string },
  ) => {
    const key = request?.idempotencyKey || "";
    if (replies.has(key)) return replies.get(key);
    const invoice = invoices.get(id)!;
    if (paid) {
      invoice.status = "paid";
      charges += 1;
    }
    const snapshot = { ...invoice };
    replies.set(key, snapshot);
    return snapshot;
  });

  return {
    stripe: {
      prices: { retrieve: retrievePrice },
      invoices: { create: createInvoice, finalizeInvoice, pay },
      invoiceItems: { create: createItem },
    } as unknown as Stripe,
    retrievePrice,
    createInvoice,
    createItem,
    charges: () => charges,
    paidInvoices: () => [...invoices.values()].filter((invoice) => invoice.status === "paid"),
    resolvePaymentMethod: () => {
      paid = true;
    },
  };
}

function options(stripe: Stripe, overrides: MinuteAccessOptions = {}): MinuteAccessOptions {
  return { stripe, overageEnabled: true, priceId: OVERAGE_PRICE_ID, ...overrides };
}

async function boundaries(store: PlatformStore, clientId: string) {
  return (await store.listOveragePurchases(clientId))
    .map((purchase) => purchase.boundaryMinutes)
    .sort((a, b) => a - b);
}

async function purchasedCredits(store: PlatformStore, clientId: string) {
  return (await store.listCreditLedger(clientId)).filter((entry) => entry.kind === "purchase");
}

describe("automatic Stripe minute blocks", () => {
  it("keeps exhausted tenants hard-stopped unless both the flag and opt-in are on", async () => {
    const store = new MemoryStore();
    const optedOut = await stripeTenant(store, "client_opted_out", false);
    const optedIn = await stripeTenant(store, "client_flag_off", true);
    const provider = fakeStripe();

    await expect(resolveMinuteAccess(store, optedOut, options(provider.stripe)))
      .resolves.toMatchObject({
        allowed: false,
        reason: "minute_allowance_exhausted",
        balance: 0,
      });
    await expect(resolveMinuteAccess(
      store,
      optedIn,
      options(provider.stripe, { overageEnabled: false }),
    )).resolves.toMatchObject({ allowed: false, reason: "minute_allowance_exhausted" });

    expect(provider.retrievePrice).not.toHaveBeenCalled();
    expect(provider.createInvoice).not.toHaveBeenCalled();
    expect(await store.listOveragePurchases(optedOut.id)).toEqual([]);
  });

  it("buys one block at the exact zero boundary on a dedicated overage-only invoice", async () => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_boundary");
    const provider = fakeStripe();

    await expect(resolveMinuteAccess(store, client, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, balance: 100, blocksPurchased: 1 });

    expect(provider.charges()).toBe(1);
    expect(await store.getCreditBalance(client.id)).toBe(100);
    expect(await store.listOveragePurchases(client.id)).toMatchObject([
      { boundaryMinutes: 0, amountMinor: 1_500, currency: "USD", status: "succeeded" },
    ]);
    expect(provider.createInvoice.mock.calls[0][0]).toMatchObject({
      customer: `cus_${client.id}`,
      pending_invoice_items_behavior: "exclude",
    });
    expect(provider.createInvoice.mock.calls[0][0]).not.toHaveProperty("subscription");
    expect(provider.createItem.mock.calls[0][0]).toMatchObject({
      pricing: { price: OVERAGE_PRICE_ID },
      quantity: 1,
    });
    expect(provider.paidInvoices()[0].items).toHaveLength(1);
  });

  it.each([
    { consumed: 0, blocks: 0, balance: 0 },
    { consumed: 1, blocks: 1, balance: 99 },
    { consumed: 100, blocks: 1, balance: 0 },
    { consumed: 200, blocks: 2, balance: 0 },
  ])(
    "settles $consumed consumed minutes with $blocks block(s) and no pre-buy at zero",
    async ({ consumed, blocks, balance }) => {
      const store = new MemoryStore();
      const client = await stripeTenant(store, `client_settle_${consumed}`);
      await consumeMinutes(store, client.id, consumed, `settle_${consumed}`);
      const provider = fakeStripe();

      await expect(resolveMinuteAccess(
        store,
        client,
        options(provider.stripe, { mode: "settlement" }),
      )).resolves.toMatchObject({ allowed: true, balance });

      expect(provider.charges()).toBe(blocks);
      expect(await store.getCreditBalance(client.id)).toBe(balance);
      expect(await boundaries(store, client.id))
        .toEqual(Array.from({ length: blocks }, (_, index) => index * 100));
    },
  );

  it("advances the block sequence to the next boundary on the following cycle", async () => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_second_cycle");
    const provider = fakeStripe();

    await expect(resolveMinuteAccess(store, client, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, balance: 100, blocksPurchased: 1 });
    await consumeMinutes(store, client.id, 100, "second_cycle");

    await expect(resolveMinuteAccess(store, client, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, balance: 100, blocksPurchased: 1 });

    expect(await boundaries(store, client.id)).toEqual([0, 100]);
    expect(provider.charges()).toBe(2);
    expect(await purchasedCredits(store, client.id)).toHaveLength(2);
    expect(await store.getCreditBalance(client.id)).toBe(100);
  });

  it("replays one charge per boundary when two callers race the same shortfall", async () => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_concurrent");
    await consumeMinutes(store, client.id, 200, "concurrent");
    const provider = fakeStripe();

    const results = await Promise.all([
      resolveMinuteAccess(store, client, options(provider.stripe)),
      resolveMinuteAccess(store, client, options(provider.stripe)),
    ]);

    expect(results.every((result) => result.allowed)).toBe(true);
    expect(await boundaries(store, client.id)).toEqual([0, 100, 200]);
    expect(provider.charges()).toBe(3);
    expect(await purchasedCredits(store, client.id)).toHaveLength(3);
    expect(await store.getCreditBalance(client.id)).toBe(100);
  });

  it.each([
    { label: "absent", price: undefined, priceId: "", reason: "overage_price_not_configured" },
    { label: "unknown", price: null, reason: "overage_price_unavailable" },
    { label: "inactive", price: { active: false, unit_amount: 1_500, currency: "usd" }, reason: "overage_price_inactive" },
    { label: "repriced", price: { active: true, unit_amount: 2_000, currency: "usd" }, reason: "overage_price_mismatch" },
    { label: "wrong currency", price: { active: true, unit_amount: 1_500, currency: "gbp" }, reason: "overage_price_mismatch" },
    { label: "recurring", price: { active: true, unit_amount: 1_500, currency: "usd", recurring: { interval: "month" } }, reason: "overage_price_mismatch" },
  ])("fails closed when the catalog price is $label", async ({ price, priceId, reason }) => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_price_guard");
    const provider = fakeStripe(price === undefined ? {} : { price });

    await expect(resolveMinuteAccess(
      store,
      client,
      options(provider.stripe, priceId === undefined ? {} : { priceId }),
    )).resolves.toMatchObject({ allowed: false, reason, balance: 0 });

    expect(provider.createInvoice).not.toHaveBeenCalled();
    expect(await store.listOveragePurchases(client.id)).toEqual([]);
    expect(await store.getCreditBalance(client.id)).toBe(0);
  });

  it("retries the same boundary after payment is fixed without charging twice", async () => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_retry");
    const provider = fakeStripe({ paid: false });

    await expect(resolveMinuteAccess(store, client, options(provider.stripe, {
      now: new Date("2026-09-10T10:00:00.000Z"),
    }))).resolves.toMatchObject({
      allowed: false,
      reason: "overage_payment_failed",
      balance: 0,
    });
    expect(await store.getCreditBalance(client.id)).toBe(0);
    expect(await store.listOveragePurchases(client.id)).toMatchObject([
      { boundaryMinutes: 0, status: "failed", failureCode: "invoice_open" },
    ]);

    provider.resolvePaymentMethod();
    await expect(resolveMinuteAccess(store, client, options(provider.stripe, {
      now: new Date("2026-09-10T10:05:00.000Z"),
    }))).resolves.toMatchObject({ allowed: true, balance: 100, blocksPurchased: 1 });

    expect(provider.charges()).toBe(1);
    expect(await boundaries(store, client.id)).toEqual([0]);
    expect(await purchasedCredits(store, client.id)).toHaveLength(1);
    expect(await store.listOveragePurchases(client.id)).toMatchObject([
      { boundaryMinutes: 0, status: "succeeded", failureCode: undefined },
    ]);

    await expect(resolveMinuteAccess(store, client, options(provider.stripe, {
      now: new Date("2026-09-10T10:06:00.000Z"),
    }))).resolves.toMatchObject({ allowed: true, reason: "entitled", balance: 100 });
    expect(provider.charges()).toBe(1);
  });

  it("does not apply Stripe credit limits to internal subscriptions", async () => {
    const store = new MemoryStore();
    const client = {
      ...robinexisDemoSeed(),
      id: "client_internal",
      slug: "client-internal",
      published: true,
      onboardingStatus: "active" as const,
      serviceStatus: "active" as const,
    };
    await store.upsertClient(client);
    await store.upsertSubscription({
      id: "sub_internal",
      clientId: client.id,
      provider: "internal",
      planTier: "pro",
      status: "active",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    await expect(resolveMinuteAccess(store, client, {
      stripe: null,
      overageEnabled: true,
    })).resolves.toMatchObject({ allowed: true, reason: "entitled" });
  });

  it("keeps granted minutes when receipt enqueue fails", async () => {
    class FailReceiptStore extends MemoryStore {
      override async enqueueNotification(delivery: import("@robinexis/database").NotificationDelivery) {
        if (delivery.idempotencyKey.startsWith("overage:receipt:")) {
          throw new Error("notification_outbox_unavailable");
        }
        return super.enqueueNotification(delivery);
      }
    }
    const store = new FailReceiptStore();
    const client = await stripeTenant(store, "client_receipt_fail");
    await store.upsertMembership({
      id: "mem_owner",
      clientId: client.id,
      email: "owner@example.test",
      role: "owner",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const provider = fakeStripe();

    await expect(resolveMinuteAccess(store, client, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, balance: 100, blocksPurchased: 1 });
    expect(await store.getCreditBalance(client.id)).toBe(100);
    expect(provider.charges()).toBe(1);
    expect(await store.listNotifications(client.id)).toEqual([]);
  });

  it("enqueues one owner receipt per purchased boundary", async () => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_receipt");
    await store.upsertMembership({
      id: "mem_owner",
      clientId: client.id,
      email: "owner@example.test",
      role: "owner",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const provider = fakeStripe();

    await expect(resolveMinuteAccess(store, client, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, balance: 100, blocksPurchased: 1 });
    await expect(resolveMinuteAccess(store, client, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, reason: "entitled", balance: 100 });
    expect(provider.charges()).toBe(1);
    expect((await store.listNotifications(client.id)).map((item) => item.idempotencyKey))
      .toEqual(["overage:receipt:minute-overage:client_receipt:0"]);
  });

  it("logs an explicit skip when no safe customer email exists", async () => {
    const store = new MemoryStore();
    const client = await stripeTenant(store, "client_no_email");
    await store.upsertClient({ ...client, email: "" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const provider = fakeStripe();

    await expect(resolveMinuteAccess(store, { ...client, email: "" }, options(provider.stripe)))
      .resolves.toMatchObject({ allowed: true, balance: 100 });
    expect(JSON.stringify(log.mock.calls)).toContain("overage_receipt_skipped");
    expect(await store.listNotifications(client.id)).toEqual([]);
    log.mockRestore();
  });
});
