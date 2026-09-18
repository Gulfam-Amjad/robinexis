import type Stripe from "stripe";
import {
  isAiServiceEnabled,
  newId,
  structuredLog,
  type ClientConfig,
  type OveragePurchaseRecord,
  type PlatformStore,
} from "@robinexis/database";
import { createStripe } from "./stripe.js";
import { enqueueLifecycleEmail } from "./notificationQueue.js";

export const MINUTE_BLOCK_MINUTES = 100;
export const MINUTE_BLOCK_AMOUNT_MINOR = 1_500;
export const MINUTE_BLOCK_CURRENCY = "USD";

/** Bounds one resolver run so a stuck grant can never bill a tenant repeatedly. */
const MAX_BLOCKS_PER_RUN = 10;

/**
 * `access` gates a call that is about to consume minutes, so a zero balance
 * must be lifted above zero. `settlement` reconciles minutes already spoken,
 * so it only covers debt back to zero and never pre-buys the next block.
 */
export type MinuteAccessMode = "access" | "settlement";

export type MinuteAccessResult = {
  allowed: boolean;
  reason: string;
  balance?: number;
  blocksPurchased?: number;
};

export type MinuteAccessOptions = {
  stripe?: Stripe | null;
  now?: Date;
  overageEnabled?: boolean;
  mode?: MinuteAccessMode;
  priceId?: string;
  maxBlocksPerRun?: number;
};

type ChargeContext = {
  clientId: string;
  customerId: string;
  subscriptionId?: string;
  priceId: string;
  now: Date;
};

export async function resolveMinuteAccess(
  store: PlatformStore,
  client: ClientConfig,
  options: MinuteAccessOptions = {},
): Promise<MinuteAccessResult> {
  const mode = options.mode || "access";
  const service = isAiServiceEnabled(client);
  if (!service.inbound) return { allowed: false, reason: service.reason };

  const now = options.now || new Date();
  const subscription = await store.getCurrentSubscription(client.id);
  if (
    subscription?.status === "trialing" &&
    subscription.trialEndsAt &&
    Date.parse(subscription.trialEndsAt) <= now.getTime()
  ) {
    return { allowed: false, reason: "trial_expired" };
  }
  if (!subscription || subscription.provider !== "stripe") {
    return { allowed: true, reason: "entitled" };
  }

  let balance = await store.getCreditBalance(client.id);
  if (!needsBlock(balance, mode)) return { allowed: true, reason: "entitled", balance };

  const globallyEnabled = options.overageEnabled
    ?? process.env.STRIPE_OVERAGE_ENABLED === "true";
  const features = await store.getTenantFeatureEntitlements(client.id);
  if (!globallyEnabled || !features?.autoMinuteBlocksEnabled) {
    return { allowed: false, reason: "minute_allowance_exhausted", balance };
  }
  if (!subscription.providerCustomerId) {
    return { allowed: false, reason: "overage_billing_unavailable", balance };
  }
  const stripe = options.stripe === undefined ? createStripe() : options.stripe;
  if (!stripe) return { allowed: false, reason: "overage_billing_unavailable", balance };

  const priceId = (options.priceId ?? process.env.STRIPE_OVERAGE_PRICE_ID ?? "").trim();
  if (!priceId) return { allowed: false, reason: "overage_price_not_configured", balance };
  const price = await verifyOveragePrice(stripe, priceId);
  if (!price.ok) return { allowed: false, reason: price.reason, balance };

  const maxBlocks = options.maxBlocksPerRun ?? MAX_BLOCKS_PER_RUN;
  let blocksPurchased = 0;
  while (needsBlock(balance, mode)) {
    if (blocksPurchased >= maxBlocks) {
      return { allowed: false, reason: "overage_block_limit_reached", balance, blocksPurchased };
    }
    const purchase = await claimNextPurchase(store, client.id, now);
    const settled = await settlePurchase(store, stripe, purchase, {
      clientId: client.id,
      customerId: subscription.providerCustomerId,
      subscriptionId: subscription.providerSubscriptionId,
      priceId,
      now,
    });
    if (!settled.ok) return { allowed: false, reason: settled.reason, balance, blocksPurchased };
    await notifyOverageReceipt(store, client, purchase).catch((error) => {
      structuredLog("overage_receipt_failed", {
        tenantId: client.id,
        operationId: purchase.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const granted = await store.getCreditBalance(client.id);
    if (granted <= balance) {
      return { allowed: false, reason: "overage_grant_stalled", balance: granted, blocksPurchased };
    }
    balance = granted;
    blocksPurchased += 1;
  }

  return {
    allowed: true,
    reason: blocksPurchased ? "overage_granted" : "entitled",
    balance,
    blocksPurchased,
  };
}

function needsBlock(balance: number, mode: MinuteAccessMode): boolean {
  return mode === "settlement" ? balance < 0 : balance <= 0;
}

function isSettled(purchase: OveragePurchaseRecord): boolean {
  if (purchase.status === "refunded") return true;
  return purchase.status === "succeeded" && Boolean(purchase.creditLedgerEntryId);
}

/**
 * Blocks form a permanent 0, 100, 200 … sequence per tenant: the next boundary
 * is taken from the stored purchases, never from the live balance, so a boundary
 * is never reused and the loop always advances. An unsettled purchase is
 * resumed before a new boundary is opened, which also makes a lost claim race
 * converge on the winner's record.
 */
async function claimNextPurchase(
  store: PlatformStore,
  clientId: string,
  now: Date,
): Promise<OveragePurchaseRecord> {
  const purchases = await store.listOveragePurchases(clientId);
  const outstanding = purchases
    .filter((purchase) => !isSettled(purchase))
    .sort((a, b) => a.boundaryMinutes - b.boundaryMinutes)[0];
  if (outstanding) return outstanding;

  const boundaryMinutes = purchases.length
    ? Math.max(...purchases.map((purchase) => purchase.boundaryMinutes)) + MINUTE_BLOCK_MINUTES
    : 0;
  const purchase: OveragePurchaseRecord = {
    id: newId("overage_"),
    clientId,
    idempotencyKey: `minute-overage:${clientId}:${boundaryMinutes}`,
    boundaryMinutes,
    grantedMinutes: MINUTE_BLOCK_MINUTES,
    amountMinor: MINUTE_BLOCK_AMOUNT_MINOR,
    currency: MINUTE_BLOCK_CURRENCY,
    status: "processing",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  if (await store.claimOveragePurchase(purchase)) return purchase;
  const existing = await store.getOveragePurchaseByIdempotency(clientId, purchase.idempotencyKey);
  if (!existing) throw new Error("overage_purchase_claim_conflict");
  return existing;
}

async function settlePurchase(
  store: PlatformStore,
  stripe: Stripe,
  purchase: OveragePurchaseRecord,
  context: ChargeContext,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let current = purchase;
  if (current.status !== "succeeded") {
    const attempt = await beginAttempt(store, current, context.now);
    const charged = await chargeOverageBlock(stripe, attempt, context);
    await store.saveOveragePurchase(charged);
    if (charged.status !== "succeeded") return { ok: false, reason: "overage_payment_failed" };
    current = charged;
  }

  const creditLedgerEntryId = current.creditLedgerEntryId
    || `credit_overage_${current.clientId}_${current.boundaryMinutes}`;
  await store.appendCreditLedgerEntry({
    id: creditLedgerEntryId,
    clientId: current.clientId,
    minutes: current.grantedMinutes,
    kind: "purchase",
    referenceType: "overage_purchase",
    referenceId: current.idempotencyKey,
    description: `Automatic ${current.grantedMinutes}-minute overage block`,
    createdAt: context.now.toISOString(),
  });
  if (!current.creditLedgerEntryId) {
    await store.saveOveragePurchase({
      ...current,
      status: "succeeded",
      creditLedgerEntryId,
      updatedAt: context.now.toISOString(),
      completedAt: current.completedAt || context.now.toISOString(),
    });
  }
  return { ok: true };
}

/**
 * A retry only starts once the previous attempt has been recorded as failed, and
 * it stamps a fresh attempt time that every Stripe idempotency key is derived
 * from. Concurrent callers read the same stored stamp, so they replay one charge
 * instead of opening a second.
 */
async function beginAttempt(
  store: PlatformStore,
  purchase: OveragePurchaseRecord,
  now: Date,
): Promise<OveragePurchaseRecord> {
  if (purchase.status === "processing" && !purchase.failureCode) return purchase;
  const attempt: OveragePurchaseRecord = {
    ...purchase,
    status: "processing",
    failureCode: undefined,
    updatedAt: now.toISOString(),
  };
  await store.saveOveragePurchase(attempt);
  return attempt;
}

async function chargeOverageBlock(
  stripe: Stripe,
  purchase: OveragePurchaseRecord,
  context: ChargeContext,
): Promise<OveragePurchaseRecord> {
  const attemptKey = `${purchase.idempotencyKey}:${purchase.updatedAt}`;
  const failed = (failureCode: string, stripePaymentId?: string): OveragePurchaseRecord => ({
    ...purchase,
    status: "failed",
    stripePaymentId: stripePaymentId || purchase.stripePaymentId,
    failureCode,
    updatedAt: context.now.toISOString(),
    completedAt: context.now.toISOString(),
  });

  try {
    // The invoice carries the overage item alone: subscription lines stay on the
    // subscription's own cycle and pending items are explicitly excluded.
    let invoice = await stripe.invoices.create({
      customer: context.customerId,
      auto_advance: false,
      collection_method: "charge_automatically",
      pending_invoice_items_behavior: "exclude",
      description: `Automatic ${purchase.grantedMinutes}-minute voice overage block`,
      metadata: {
        clientId: context.clientId,
        overagePurchaseId: purchase.id,
        boundaryMinutes: String(purchase.boundaryMinutes),
        ...(context.subscriptionId ? { subscriptionId: context.subscriptionId } : {}),
      },
    }, { idempotencyKey: `${attemptKey}:invoice` });
    const invoiceId = invoice.id;
    if (!invoiceId) return failed("invoice_id_missing");

    if (invoice.status === "draft") {
      await stripe.invoiceItems.create({
        customer: context.customerId,
        invoice: invoiceId,
        pricing: { price: context.priceId },
        quantity: 1,
        metadata: { clientId: context.clientId, overagePurchaseId: purchase.id },
      }, { idempotencyKey: `${attemptKey}:item` });
      invoice = await stripe.invoices.finalizeInvoice(
        invoiceId,
        {},
        { idempotencyKey: `${attemptKey}:finalize` },
      );
    }
    if (invoice.status !== "paid") {
      invoice = await stripe.invoices.pay(
        invoiceId,
        {},
        { idempotencyKey: `${attemptKey}:pay` },
      );
    }
    if (invoice.status !== "paid") {
      return failed(`invoice_${invoice.status || "unpaid"}`, invoiceId);
    }
    return {
      ...purchase,
      status: "succeeded",
      stripePaymentId: invoiceId,
      failureCode: undefined,
      updatedAt: context.now.toISOString(),
      completedAt: context.now.toISOString(),
    };
  } catch (error) {
    return failed(stripeFailureCode(error));
  }
}

/** Fails closed: an absent, inactive, recurring or repriced catalog entry never charges. */
async function verifyOveragePrice(
  stripe: Stripe,
  priceId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch {
    return { ok: false, reason: "overage_price_unavailable" };
  }
  if (!price || price.active === false) return { ok: false, reason: "overage_price_inactive" };
  if (price.recurring) return { ok: false, reason: "overage_price_mismatch" };
  if (price.unit_amount !== MINUTE_BLOCK_AMOUNT_MINOR) {
    return { ok: false, reason: "overage_price_mismatch" };
  }
  if ((price.currency || "").toLowerCase() !== MINUTE_BLOCK_CURRENCY.toLowerCase()) {
    return { ok: false, reason: "overage_price_mismatch" };
  }
  return { ok: true };
}

function overageReceiptEmail(
  client: ClientConfig,
  memberships: Array<{ email: string; role: string }>,
): string | undefined {
  const owner = memberships.find((membership) => membership.role === "owner")?.email;
  const candidate = (owner || client.email || "").trim().toLowerCase();
  if (!candidate.includes("@") || candidate.endsWith(".invalid")) return undefined;
  return candidate;
}

async function notifyOverageReceipt(
  store: PlatformStore,
  client: ClientConfig,
  purchase: OveragePurchaseRecord,
): Promise<void> {
  const to = overageReceiptEmail(client, await store.listMembershipsForClient(client.id));
  if (!to) {
    structuredLog("overage_receipt_skipped", {
      tenantId: client.id,
      operationId: purchase.id,
      reason: "recipient_missing",
    });
    return;
  }
  await enqueueLifecycleEmail({
    store,
    clientId: client.id,
    operationId: purchase.id,
    idempotencyKey: `overage:receipt:${purchase.idempotencyKey}`,
    to,
    template: [
      `${client.businessName}: a ${purchase.grantedMinutes}-minute voice overage block was added`,
      "",
      `Amount: ${(purchase.amountMinor / 100).toFixed(2)} ${purchase.currency}`,
      "This receipt does not include payment credentials.",
    ].join("\n"),
  });
}

function stripeFailureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code || "stripe_error").slice(0, 100);
  }
  return "stripe_charge_failed";
}
