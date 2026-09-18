import {
  newId,
  redactSecrets,
  structuredLog,
  type MessageEvent,
  type NotificationDelivery,
  type PlatformStore,
} from "@robinexis/database";
import { sendNotification } from "./notifications.js";
import { messageAllowancePeriod } from "./messageAllowance.js";

export async function enqueueLifecycleEmail(input: {
  store: PlatformStore;
  clientId: string;
  operationId: string;
  idempotencyKey: string;
  to?: string;
  template: string;
  now?: string;
  maxAttempts?: number;
}): Promise<{ queued: boolean; id?: string }> {
  if (!input.to) {
    structuredLog("lifecycle_notification_skipped", {
      tenantId: input.clientId, operationId: input.operationId, reason: "recipient_missing",
    });
    return { queued: false };
  }
  const now = input.now || new Date().toISOString();
  const delivery: NotificationDelivery = {
    id: newId("notification_"),
    clientId: input.clientId,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    channel: "email",
    recipient: input.to.trim().toLowerCase(),
    template: input.template,
    status: "pending",
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 5,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const queued = await input.store.enqueueNotification(delivery);
  structuredLog(queued ? "lifecycle_notification_queued" : "lifecycle_notification_duplicate", {
    tenantId: input.clientId, operationId: input.operationId, notificationId: delivery.id,
  });
  return { queued, id: queued ? delivery.id : undefined };
}

export async function enqueueWhatsAppNotification(input: {
  store: PlatformStore;
  clientId: string;
  operationId: string;
  idempotencyKey: string;
  to: string;
  from: string;
  template: string;
  sessionId: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
  complianceOverride?: boolean;
  now?: string;
  maxAttempts?: number;
}): Promise<{ queued: boolean; id?: string }> {
  const now = input.now || new Date().toISOString();
  const delivery: NotificationDelivery = {
    id: newId("notification_"),
    clientId: input.clientId,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    channel: "whatsapp",
    recipient: input.to,
    template: input.template,
    payload: {
      from: input.from,
      sessionId: input.sessionId,
      contentSid: input.contentSid,
      contentVariables: input.contentVariables,
      complianceOverride: input.complianceOverride === true,
    },
    status: "pending",
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 5,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const queued = await input.store.enqueueNotification(delivery);
  return { queued, id: queued ? delivery.id : undefined };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return String(redactSecrets(message)).slice(0, 500);
}

export async function processNotificationDeliveries(input: {
  store: PlatformStore;
  workerId: string;
  now?: Date;
  limit?: number;
  send?: typeof sendNotification;
}): Promise<{ delivered: number; retried: number; deadLettered: number }> {
  const now = input.now || new Date();
  const deliveries = await input.store.claimNotifications(
    input.workerId, now.toISOString(), 5 * 60, input.limit ?? 20,
  );
  const result = { delivered: 0, retried: 0, deadLettered: 0 };
  for (const delivery of deliveries) {
    structuredLog("notification_provider_call_started", {
      tenantId: delivery.clientId, operationId: delivery.operationId,
      notificationId: delivery.id, attempt: delivery.attemptCount,
    });
    try {
      let outboundEvent: MessageEvent | undefined;
      if (delivery.channel === "whatsapp") {
        if (process.env.WHATSAPP_ENABLED !== "true") throw new Error("whatsapp_disabled");
        const entitlement = await input.store.getTenantFeatureEntitlements(delivery.clientId);
        if (!entitlement?.whatsappEnabled) throw new Error("whatsapp_not_entitled");
        const sessionId = String(delivery.payload?.sessionId || "");
        const session = await input.store.getMessageSession(delivery.clientId, sessionId);
        if (!session) throw new Error("whatsapp_session_not_found");
        if (session.status === "opted_out" && delivery.payload?.complianceOverride !== true) {
          throw new Error("whatsapp_recipient_opted_out");
        }
        const complianceOverride = delivery.payload?.complianceOverride === true;
        outboundEvent = {
          id: newId("message_event_"),
          clientId: delivery.clientId,
          sessionId,
          channel: "whatsapp",
          direction: "outbound",
          provider: "twilio",
          idempotencyKey: `notification:${delivery.idempotencyKey}`,
          status: "queued",
          body: delivery.template,
          billableUnits: complianceOverride ? 0 : 1,
          metadata: { notificationId: delivery.id, complianceOverride },
          occurredAt: now.toISOString(),
          createdAt: now.toISOString(),
        };
        const reservation = complianceOverride
          ? await input.store.appendMessageEvent(outboundEvent)
            ? "reserved"
            : "duplicate"
          : await input.store.reserveMessageEventAllowance(
              outboundEvent,
              await messageAllowancePeriod(input.store, delivery.clientId, "whatsapp", now),
            );
        if (reservation === "exhausted") throw new Error("whatsapp_message_allowance_exhausted");
        if (reservation === "duplicate") {
          const prior = (await input.store.listMessageEvents(delivery.clientId, sessionId))
            .find((event) => event.idempotencyKey === outboundEvent?.idempotencyKey);
          if (prior?.providerMessageId) {
            const completed = await input.store.completeNotification(
              delivery.clientId, delivery.id, input.workerId, prior.providerMessageId, now.toISOString(),
            );
            if (!completed) throw new Error("notification_lease_lost_after_provider_success");
            result.delivered++;
            continue;
          }
        }
      }
      const sent = await (input.send || sendNotification)({
        channel: delivery.channel, to: delivery.recipient, template: delivery.template,
        idempotencyKey: delivery.idempotencyKey,
        payload: { ...delivery.payload, notificationId: delivery.id, clientId: delivery.clientId },
      });
      if (outboundEvent) {
        await input.store.updateMessageEventProviderStatus(
          delivery.clientId,
          outboundEvent.idempotencyKey,
          sent.providerId,
          "sent",
          { notificationId: delivery.id },
          now.toISOString(),
        );
      }
      const completed = await input.store.completeNotification(
        delivery.clientId, delivery.id, input.workerId, sent.providerId, now.toISOString(),
      );
      if (!completed) throw new Error("notification_lease_lost_after_provider_success");
      result.delivered++;
      structuredLog("notification_provider_call_succeeded", {
        tenantId: delivery.clientId, operationId: delivery.operationId,
        notificationId: delivery.id, providerId: sent.providerId,
      });
    } catch (error) {
      const redacted = safeError(error);
      structuredLog("notification_provider_call_failed", {
        tenantId: delivery.clientId, operationId: delivery.operationId,
        notificationId: delivery.id, attempt: delivery.attemptCount, error: redacted,
      });
      const retryAt = new Date(now.getTime() + Math.min(60, 2 ** delivery.attemptCount) * 60_000).toISOString();
      const retried = await input.store.retryNotification(
        delivery.clientId, delivery.id, input.workerId, redacted, retryAt,
      );
      if (retried) {
        result.retried++;
      } else {
        const dead = await input.store.deadLetterNotification(
          delivery.clientId, delivery.id, input.workerId, redacted, now.toISOString(),
        );
        if (!dead) throw new Error("notification_lease_lost_during_failure");
        result.deadLettered++;
        structuredLog("notification_dead_lettered", {
          tenantId: delivery.clientId, operationId: delivery.operationId,
          notificationId: delivery.id, attempts: delivery.attemptCount,
        });
      }
    }
  }
  return result;
}
