import {
  newId,
  type MessageChannel,
  type MessageUsagePeriod,
  type PlatformStore,
} from "@robinexis/database";
import { planDefinition } from "./plans.js";

/** Canonical subscription-period normalization for all metered message paths. */
export async function messageAllowancePeriod(
  store: PlatformStore,
  clientId: string,
  channel: MessageChannel,
  now: Date,
): Promise<MessageUsagePeriod> {
  const subscription = await store.getCurrentSubscription(clientId);
  if (!subscription || (subscription.status !== "active" && subscription.status !== "trialing")) {
    throw new Error(`${channel}_subscription_inactive`);
  }
  const periodStart = subscription.currentPeriodStart
    ? new Date(subscription.currentPeriodStart)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime())) {
    throw new Error(`${channel}_billing_period_invalid`);
  }
  const timestamp = now.toISOString();
  return {
    id: newId("message_usage_"),
    clientId,
    channel,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    includedMessages: planDefinition(subscription.planTier).includedMessages,
    usedMessages: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function hasRemainingMessageAllowance(
  store: PlatformStore,
  clientId: string,
  channel: MessageChannel,
  now: Date,
): Promise<boolean> {
  try {
    const period = await messageAllowancePeriod(store, clientId, channel, now);
    if (period.includedMessages <= 0) return false;
    const usage = await store.getMessageUsagePeriod(clientId, channel, period.periodStart);
    return (usage?.usedMessages ?? 0) < period.includedMessages;
  } catch {
    return false;
  }
}

export async function whatsappAllowanceSnapshot(
  store: PlatformStore,
  clientId: string,
  planTier: "starter" | "pro" | "enterprise",
  now = new Date(),
): Promise<{
  includedMessages: number;
  usedMessages: number;
  remainingMessages: number;
  limitReached: boolean;
}> {
  const includedMessages = planDefinition(planTier).includedMessages;
  try {
    const period = await messageAllowancePeriod(store, clientId, "whatsapp", now);
    const usage = await store.getMessageUsagePeriod(clientId, "whatsapp", period.periodStart);
    const usedMessages = usage?.usedMessages ?? 0;
    const included = usage?.includedMessages ?? period.includedMessages;
    return {
      includedMessages: included,
      usedMessages,
      remainingMessages: Math.max(0, included - usedMessages),
      limitReached: usedMessages >= included,
    };
  } catch {
    return {
      includedMessages,
      usedMessages: 0,
      remainingMessages: Math.max(0, includedMessages),
      limitReached: includedMessages <= 0,
    };
  }
}
