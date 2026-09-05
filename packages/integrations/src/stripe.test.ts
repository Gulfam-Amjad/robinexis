import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import { createCheckoutSession, handleStripeWebhook } from "./stripe.js";

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
        payment_method_collection: "if_required",
        metadata: { clientId: "client_two", plan: "pro" },
        line_items: [{ price: "price_pro", quantity: 1 }],
        subscription_data: {
          trial_period_days: 3,
          metadata: { clientId: "client_two", plan: "pro" },
        },
      }),
    );
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
});
