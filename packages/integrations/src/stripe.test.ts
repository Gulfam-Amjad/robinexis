import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import { createBillingPortalSession, createCheckoutSession, handleStripeWebhook } from "./stripe.js";

afterEach(() => {
  delete process.env.STRIPE_PRICE_IDS_JSON;
});

describe("createCheckoutSession", () => {
  it("keeps the application usable when Stripe is not configured", async () => {
    await expect(
      createCheckoutSession({
        clientId: "client_one",
        plan: "starter",
        successUrl: "https://app.example/success",
        cancelUrl: "https://app.example/cancel",
        stripe: null,
      }),
    ).resolves.toEqual({ configured: false, reason: "stripe_not_configured" });
  });

  it("creates tenant-bound checkout with an idempotency key", async () => {
    process.env.STRIPE_PRICE_IDS_JSON = JSON.stringify({ pro: "price_pro" });
    const create = vi.fn().mockResolvedValue({ id: "cs_123", url: "https://checkout.test/cs_123" });
    const stripe = {
      checkout: { sessions: { create } },
    } as unknown as Stripe;

    await expect(
      createCheckoutSession({
        clientId: "client_two",
        plan: "pro",
        successUrl: "https://app.example/success",
        cancelUrl: "https://app.example/cancel",
        customerEmail: "owner@example.test",
        idempotencyKey: "checkout:client_two:pro:1",
        stripe,
      }),
    ).resolves.toEqual({
      configured: true,
      id: "cs_123",
      url: "https://checkout.test/cs_123",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: "client_two",
        payment_method_collection: "always",
        metadata: { clientId: "client_two", plan: "pro" },
        line_items: [{ price: "price_pro", quantity: 1 }],
        subscription_data: {
          trial_period_days: 3,
          metadata: { clientId: "client_two", plan: "pro" },
        },
      }),
      { idempotencyKey: "checkout:client_two:pro:1" },
    );
  });

  it("creates a customer-scoped billing portal session", async () => {
    const create = vi.fn().mockResolvedValue({ id: "bps_123", url: "https://billing.stripe.test/session" });
    const stripe = { billingPortal: { sessions: { create } } } as unknown as Stripe;
    await expect(createBillingPortalSession({
      customerId: "cus_tenant",
      returnUrl: "https://app.example/billing",
      stripe,
    })).resolves.toEqual({
      configured: true,
      id: "bps_123",
      url: "https://billing.stripe.test/session",
    });
    expect(create).toHaveBeenCalledWith({
      customer: "cus_tenant",
      return_url: "https://app.example/billing",
    });
  });

  it("verifies, normalizes, and idempotently records subscription webhooks", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const event = {
      id: "evt_subscription_1",
      type: "customer.subscription.updated",
      livemode: true,
      created: 1_788_511_200,
      data: {
        object: {
          id: "sub_1",
          object: "subscription",
          customer: "cus_1",
          status: "active",
          created: 1_788_511_200,
          trial_end: null,
          cancel_at_period_end: false,
          metadata: { clientId: BLADES_HAIR_ID, plan: "pro" },
          items: { data: [{ price: { id: "price_pro", metadata: {} } }] },
        },
      },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const stripe = {
      webhooks: { constructEvent },
      subscriptions: { retrieve: vi.fn() },
    } as unknown as Stripe;
    const input = {
      store,
      rawBody: Buffer.from("{}"),
      signature: "valid-signature",
      webhookSecret: "whsec_test",
      stripe,
    };

    await expect(handleStripeWebhook(input)).resolves.toEqual({ ok: true, status: "active" });
    await expect(handleStripeWebhook(input)).resolves.toEqual({ ok: true, status: "duplicate" });
    event.id = "evt_subscription_same_period_retry";
    await expect(handleStripeWebhook(input)).resolves.toEqual({ ok: true, status: "active" });
    expect(constructEvent).toHaveBeenCalledWith(
      input.rawBody,
      input.signature,
      input.webhookSecret,
    );
    await expect(store.getCurrentSubscription(BLADES_HAIR_ID)).resolves.toMatchObject({
      provider: "stripe",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      planTier: "pro",
      status: "active",
    });
    await expect(store.getStripeEvent(BLADES_HAIR_ID, event.id)).resolves.toMatchObject({
      status: "processed",
    });
    await expect(store.getClient(BLADES_HAIR_ID)).resolves.toMatchObject({
      subscribedProduct: "pro",
      monthlyMinuteLimit: 1_500,
    });
    expect(await store.getCreditBalance(BLADES_HAIR_ID)).toBe(1_500);
    expect(await store.listCreditLedger(BLADES_HAIR_ID)).toHaveLength(1);
  });

  it("keeps unresolved Stripe events failed for audited recovery", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const event = {
      id: "evt_unmatched",
      type: "customer.subscription.updated",
      livemode: false,
      created: 1_788_511_200,
      data: { object: {
        id: "sub_unknown", object: "subscription", customer: "cus_unknown", status: "active",
        created: 1_788_511_200, trial_end: null, cancel_at_period_end: false,
        metadata: {}, items: { data: [{ price: { id: "price_unknown", metadata: {} } }] },
      } },
    } as unknown as Stripe.Event;
    const stripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(event) },
      subscriptions: { retrieve: vi.fn() },
    } as unknown as Stripe;
    await expect(handleStripeWebhook({
      store, rawBody: "{}", signature: "valid", webhookSecret: "whsec_test", stripe,
    })).resolves.toEqual({ ok: false, status: "unmatched" });
    await expect(store.listStripeEvents("failed")).resolves.toEqual([
      expect.objectContaining({ id: event.id, error: "tenant_unmatched" }),
    ]);
  });

  it("rejects missing or invalid webhook signatures without throwing", async () => {
    const store = new MemoryStore();
    const constructEvent = vi.fn(() => {
      throw new Error("No stripe-signature header value was provided.");
    });
    const stripe = {
      webhooks: { constructEvent },
    } as unknown as Stripe;

    await expect(
      handleStripeWebhook({
        store,
        rawBody: "{}",
        signature: "",
        webhookSecret: "whsec_test",
        stripe,
      }),
    ).resolves.toEqual({ ok: false, status: "invalid_signature" });
    expect(constructEvent).toHaveBeenCalled();
  });

  it("forces past_due on invoice.payment_failed for the metadata tenant only", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const other = (await store.listClients()).find((client) => client.id !== BLADES_HAIR_ID);
    expect(other).toBeTruthy();
    const bladesBefore = await store.getClient(BLADES_HAIR_ID);
    const event = {
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      livemode: false,
      created: 1_788_511_200,
      data: {
        object: {
          object: "invoice",
          subscription: "sub_failed",
        },
      },
    } as unknown as Stripe.Event;
    const stripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(event) },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_failed",
          customer: "cus_failed",
          status: "active",
          created: 1_788_511_200,
          trial_end: null,
          cancel_at_period_end: false,
          metadata: { clientId: other!.id, plan: "starter" },
          items: { data: [{ price: { id: "price_starter" } }] },
        }),
      },
    } as unknown as Stripe;

    await expect(
      handleStripeWebhook({
        store,
        rawBody: Buffer.from("{}"),
        signature: "sig",
        webhookSecret: "whsec_test",
        stripe,
      }),
    ).resolves.toEqual({ ok: true, status: "past_due" });
    await expect(store.getClient(other!.id)).resolves.toMatchObject({ serviceStatus: "past_due" });
    await expect(store.getClient(BLADES_HAIR_ID)).resolves.toMatchObject({
      serviceStatus: bladesBefore?.serviceStatus,
    });
  });

  it("processes invoice.payment_succeeded using the current invoice parent shape", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const client = (await store.listClients()).find((item) => item.id !== BLADES_HAIR_ID)!;
    const event = {
      id: "evt_invoice_succeeded_1",
      type: "invoice.payment_succeeded",
      livemode: true,
      created: 1_788_511_200,
      data: {
        object: {
          object: "invoice",
          parent: { subscription_details: { subscription: "sub_succeeded" } },
        },
      },
    } as unknown as Stripe.Event;
    const stripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(event) },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_succeeded",
          customer: "cus_succeeded",
          status: "active",
          created: 1_788_511_200,
          trial_end: null,
          cancel_at_period_end: false,
          metadata: { clientId: client.id, plan: "pro" },
          items: { data: [{ price: { id: "price_pro" } }] },
        }),
      },
    } as unknown as Stripe;

    await expect(
      handleStripeWebhook({
        store,
        rawBody: Buffer.from("{}"),
        signature: "sig",
        webhookSecret: "whsec_test",
        stripe,
      }),
    ).resolves.toEqual({ ok: true, status: "active" });
    await expect(store.getClient(client.id)).resolves.toMatchObject({
      serviceStatus: "active",
      subscribedProduct: "pro",
    });
  });

  it.each([
    ["customer.subscription.created", "trialing"],
    ["customer.subscription.deleted", "canceled"],
  ] as const)("processes %s as %s", async (eventType, expectedStatus) => {
    const store = new MemoryStore();
    await seedStore(store);
    const client = (await store.listClients()).find((item) => item.id !== BLADES_HAIR_ID)!;
    const event = {
      id: `evt_${eventType}`,
      type: eventType,
      livemode: true,
      created: 1_788_511_200,
      data: {
        object: {
          id: "sub_lifecycle",
          customer: "cus_lifecycle",
          status: "trialing",
          created: 1_788_511_200,
          trial_end: 1_788_770_400,
          cancel_at_period_end: false,
          metadata: { clientId: client.id, plan: "starter" },
          items: { data: [{ price: { id: "price_starter" } }] },
        },
      },
    } as unknown as Stripe.Event;
    const stripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(event) },
      subscriptions: { retrieve: vi.fn() },
    } as unknown as Stripe;

    await expect(
      handleStripeWebhook({
        store,
        rawBody: Buffer.from("{}"),
        signature: "sig",
        webhookSecret: "whsec_test",
        stripe,
      }),
    ).resolves.toEqual({ ok: true, status: expectedStatus });
  });

  it("processes checkout.session.completed by retrieving its tenant-bound subscription", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const client = (await store.listClients()).find((item) => item.id !== BLADES_HAIR_ID)!;
    const event = {
      id: "evt_checkout_completed_1",
      type: "checkout.session.completed",
      livemode: true,
      created: 1_788_511_200,
      data: {
        object: {
          id: "cs_completed",
          subscription: "sub_checkout",
          customer: "cus_checkout",
          client_reference_id: client.id,
          metadata: { clientId: client.id, plan: "starter" },
        },
      },
    } as unknown as Stripe.Event;
    const stripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(event) },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_checkout",
          customer: "cus_checkout",
          status: "trialing",
          created: 1_788_511_200,
          trial_end: 1_788_770_400,
          cancel_at_period_end: false,
          metadata: { clientId: client.id, plan: "starter" },
          items: { data: [{ price: { id: "price_starter" } }] },
        }),
      },
    } as unknown as Stripe;

    await expect(
      handleStripeWebhook({
        store,
        rawBody: Buffer.from("{}"),
        signature: "sig",
        webhookSecret: "whsec_test",
        stripe,
      }),
    ).resolves.toEqual({ ok: true, status: "trialing" });
  });
});
