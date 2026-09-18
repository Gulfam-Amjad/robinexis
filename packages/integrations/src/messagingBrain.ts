import {
  BrainSession,
  GroqDriver,
  compilePrompt,
  type LlmDriver,
  type LlmMessage,
  type ToolExecutor,
} from "@robinexis/brain";
import {
  newId,
  type CallSession,
  type ClientConfig,
  type MessageEvent,
  type MessageSession,
  type PlatformStore,
} from "@robinexis/database";
import { createToolExecutor } from "./tools.js";
import { enqueueWhatsAppNotification } from "./notificationQueue.js";
import { hasRemainingMessageAllowance } from "./messageAllowance.js";

const MAX_STATE_MESSAGES = 12;
const MAX_REPLY_CHARS = 1_500;
const DEFAULT_MAX_ATTEMPTS = 5;

type ToolOptions = Omit<Parameters<typeof createToolExecutor>[0], "store">;

export interface MessagingBrainDependencies extends ToolOptions {
  llm?: LlmDriver;
  createLlm?: () => LlmDriver;
  now?: () => Date;
}

export interface MessagingBrainResult {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
  suppressed: number;
}

function compactMessages(value: unknown): LlmMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LlmMessage[] => {
    if (!item || typeof item !== "object") return [];
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    return (role === "user" || role === "assistant") && typeof content === "string"
      ? [{ role, content: content.slice(0, 2_000) }]
      : [];
  }).slice(-MAX_STATE_MESSAGES);
}

function callFor(session: MessageSession, client: ClientConfig, now: string): CallSession {
  return {
    id: `message_call_${session.id}`,
    clientId: client.id,
    direction: "inbound",
    objective: "Help this WhatsApp customer using approved facts and booking tools",
    contactPhone: session.contactAddress.replace(/^whatsapp:/, ""),
    promptVersionId: client.promptVersionId || `message_prompt_${client.id}`,
    transcript: [],
    collected: {},
    toolHistory: [],
    state: "messaging",
    status: "active",
    createdAt: session.createdAt || now,
    updatedAt: now,
  };
}

function textPrompt(client: ClientConfig) {
  return `${compilePrompt({ client, direction: "inbound", objective: "WhatsApp customer service" })}

Channel rules: This is a WhatsApp text conversation, never a phone or voice call. Keep replies concise and plain text. Do not say you will transfer a live call. Never mention ElevenLabs. Use only approved facts or tool results.`;
}

async function suppressReply(
  store: PlatformStore,
  event: MessageEvent,
  session: MessageSession,
  reason: string,
  now: string,
) {
  return store.appendMessageEvent({
    id: newId("message_event_"),
    clientId: event.clientId,
    sessionId: session.id,
    channel: "whatsapp",
    direction: "outbound",
    provider: "twilio",
    idempotencyKey: `whatsapp:reply:${event.id}`,
    status: "suppressed",
    body: undefined,
    billableUnits: 0,
    metadata: { reason, inboundEventId: event.id },
    occurredAt: now,
    createdAt: now,
  });
}

async function enqueueReply(
  store: PlatformStore,
  event: MessageEvent,
  session: MessageSession,
  text: string,
  now: string,
) {
  const windowOpen = Boolean(
    session.serviceWindowExpiresAt && Date.parse(session.serviceWindowExpiresAt) > Date.parse(now),
  );
  const outsideContentSid = process.env.WHATSAPP_OUTSIDE_WINDOW_CONTENT_SID?.trim();
  if (!windowOpen && !outsideContentSid) {
    await suppressReply(store, event, session, "service_window_expired_no_approved_template", now);
    return false;
  }
  await enqueueWhatsAppNotification({
    store,
    clientId: event.clientId,
    operationId: `whatsapp_reply_${event.id}`,
    idempotencyKey: `whatsapp:reply:${event.id}`,
    to: session.contactAddress,
    from: session.senderAddress,
    template: windowOpen
      ? text.slice(0, MAX_REPLY_CHARS)
      : (process.env.WHATSAPP_OUTSIDE_WINDOW_TEMPLATE_TEXT || "Please reply to continue this conversation."),
    sessionId: session.id,
    contentSid: windowOpen ? undefined : outsideContentSid,
    now,
  });
  return true;
}

async function enqueueBookingConfirmation(
  store: PlatformStore,
  event: MessageEvent,
  session: MessageSession,
  call: CallSession,
  now: string,
) {
  if (!call.appointmentId) return;
  const contentSid = process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID?.trim();
  const windowOpen = Boolean(
    session.serviceWindowExpiresAt && Date.parse(session.serviceWindowExpiresAt) > Date.parse(now),
  );
  if (!windowOpen && !contentSid) return;
  await enqueueWhatsAppNotification({
    store,
    clientId: event.clientId,
    operationId: `whatsapp_booking_${call.appointmentId}`,
    idempotencyKey: `whatsapp:booking:${call.appointmentId}`,
    to: session.contactAddress,
    from: session.senderAddress,
    template: process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_TEXT || "Your booking is confirmed.",
    sessionId: session.id,
    contentSid,
    contentVariables: { bookingUid: call.appointmentId },
    now,
  });
}

export async function processInboundWhatsAppMessages(input: {
  store: PlatformStore;
  workerId: string;
  dependencies?: MessagingBrainDependencies;
  now?: Date;
  limit?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
}): Promise<MessagingBrainResult> {
  const nowDate = input.now || input.dependencies?.now?.() || new Date();
  const now = nowDate.toISOString();
  const events = await input.store.claimInboundMessageEvents(
    input.workerId,
    now,
    input.leaseSeconds ?? 5 * 60,
    input.limit ?? 10,
  );
  const result: MessagingBrainResult = {
    claimed: events.length, processed: 0, retried: 0, failed: 0, suppressed: 0,
  };

  for (const event of events) {
    try {
      const session = await input.store.getMessageSession(event.clientId, event.sessionId);
      const client = await input.store.getClient(event.clientId);
      if (!session || !client) throw new Error("messaging_context_not_found");
      const command = String(event.metadata.command || "message");
      if (command !== "message") {
        await input.store.completeInboundMessageEvent(event.clientId, event.id, input.workerId, now);
        result.processed++;
        continue;
      }
      const entitlement = await input.store.getTenantFeatureEntitlements(event.clientId);
      if (!entitlement?.whatsappEnabled || session.status !== "active" ||
          !(await hasRemainingMessageAllowance(input.store, event.clientId, "whatsapp", nowDate))) {
        await suppressReply(input.store, event, session, "whatsapp_not_available", now);
        await input.store.completeInboundMessageEvent(event.clientId, event.id, input.workerId, now);
        result.processed++;
        result.suppressed++;
        continue;
      }
      const processedIds = Array.isArray(session.state.processedInboundIds)
        ? session.state.processedInboundIds.filter((id): id is string => typeof id === "string")
        : [];
      if (processedIds.includes(event.id)) {
        await input.store.completeInboundMessageEvent(event.clientId, event.id, input.workerId, now);
        result.processed++;
        continue;
      }

      const call = callFor(session, client, now);
      await input.store.saveCall(call);
      const baseExecutor = createToolExecutor({ store: input.store, ...input.dependencies });
      const tools: ToolExecutor = (request) => {
        const needsIdempotency = ["create_booking", "reschedule_booking", "cancel_booking", "append_calendar_note"]
          .includes(request.name);
        return baseExecutor({
          ...request,
          input: needsIdempotency
            ? { ...request.input, idempotencyKey: `whatsapp:${event.id}:${request.name}` }
            : request.input,
        });
      };
      const llm = input.dependencies?.llm || input.dependencies?.createLlm?.() || new GroqDriver();
      const brain = new BrainSession(
        llm,
        tools,
        client,
        call,
        undefined,
        textPrompt(client),
        {
          initialMessages: compactMessages(session.state.conversation),
          maxToolIterations: Number(process.env.WHATSAPP_BRAIN_MAX_TOOL_ITERATIONS) || 4,
        },
      );
      const turn = await brain.handleUserTurn((event.body || "").slice(0, 4_000));
      const reply = turn.type === "speak"
        ? turn.text
        : "I can arrange for someone from the team to follow up. What is the best way to help?";
      const queued = await enqueueReply(input.store, event, session, reply, now);

      // Booking success is durable before notification. A notification adapter or
      // outbox failure must not undo or retry the calendar booking.
      await enqueueBookingConfirmation(input.store, event, session, call, now).catch(() => undefined);
      session.state = {
        ...session.state,
        conversation: compactMessages(brain.getMessages()),
        processedInboundIds: [...processedIds, event.id].slice(-20),
        lastReplyQueued: queued,
        lastInboundEventId: event.id,
      };
      session.updatedAt = now;
      await input.store.saveCall({ ...call, updatedAt: now });
      await input.store.saveMessageSession(session);
      const completed = await input.store.completeInboundMessageEvent(
        event.clientId, event.id, input.workerId, now,
      );
      if (!completed) throw new Error("inbound_message_lease_lost");
      result.processed++;
      if (!queued) result.suppressed++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const retryAt = new Date(nowDate.getTime() +
        Math.min(60, 2 ** (event.processingAttemptCount ?? 1)) * 60_000).toISOString();
      const retried = await input.store.retryInboundMessageEvent(
        event.clientId,
        event.id,
        input.workerId,
        message,
        retryAt,
        input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      );
      if (retried) result.retried++;
      else result.failed++;
    }
  }
  return result;
}

export async function processScheduledWhatsAppFollowups(input: {
  store: PlatformStore;
  workerId: string;
  now?: Date;
  limit?: number;
}) {
  const now = input.now || new Date();
  const followups = await input.store.claimScheduledFollowups(
    input.workerId, now.toISOString(), 5 * 60, input.limit ?? 20,
  );
  const result = { claimed: followups.length, queued: 0, suppressed: 0, retried: 0 };
  for (const followup of followups) {
    try {
      const session = followup.sessionId
        ? await input.store.getMessageSession(followup.clientId, followup.sessionId)
        : undefined;
      if (!session || session.status !== "active") throw new Error("followup_session_unavailable");
      const windowOpen = Boolean(
        session.serviceWindowExpiresAt &&
        Date.parse(session.serviceWindowExpiresAt) > now.getTime(),
      );
      const contentSid = typeof followup.payload.contentSid === "string"
        ? followup.payload.contentSid
        : undefined;
      if (!windowOpen && !contentSid) {
        followup.status = "completed";
        followup.completedAt = now.toISOString();
        result.suppressed++;
      } else {
        await enqueueWhatsAppNotification({
          store: input.store,
          clientId: followup.clientId,
          operationId: `whatsapp_followup_${followup.id}`,
          idempotencyKey: `followup:${followup.idempotencyKey}`,
          to: followup.recipient,
          from: session.senderAddress,
          template: followup.template,
          sessionId: session.id,
          contentSid,
          contentVariables: followup.payload.contentVariables as Record<string, string> | undefined,
          now: now.toISOString(),
        });
        followup.status = "completed";
        followup.completedAt = now.toISOString();
        result.queued++;
      }
      followup.leaseOwner = undefined;
      followup.leaseExpiresAt = undefined;
      followup.updatedAt = now.toISOString();
      await input.store.saveScheduledFollowup(followup, input.workerId);
    } catch (error) {
      followup.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      followup.status = followup.attemptCount >= followup.maxAttempts ? "dead_letter" : "pending";
      followup.scheduledAt = new Date(
        now.getTime() + Math.min(60, 2 ** followup.attemptCount) * 60_000,
      ).toISOString();
      followup.leaseOwner = undefined;
      followup.leaseExpiresAt = undefined;
      followup.updatedAt = now.toISOString();
      await input.store.saveScheduledFollowup(followup, input.workerId);
      result.retried++;
    }
  }
  return result;
}
