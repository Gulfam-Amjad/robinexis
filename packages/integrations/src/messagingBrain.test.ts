import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryStore,
  type ClientConfig,
  type MessageEvent,
  type MessageSession,
  type NotificationDelivery,
} from "@robinexis/database";
import { ScriptedLlm, type LlmDriver } from "@robinexis/brain";
import { FakeCalendar } from "./fakeCalendar.js";
import { processInboundWhatsAppMessages } from "./messagingBrain.js";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function client(): ClientConfig {
  return {
    id: "tenant_a",
    slug: "tenant-a",
    businessName: "Tenant A",
    role: "receptionist",
    tone: "brief",
    location: "London",
    phone: "+442000000001",
    email: "hello@example.test",
    transferNumber: "+442000000002",
    voiceId: "unused-for-text",
    voicePipeline: "elevenlabs-convai",
    services: [{ slug: "cut", title: "Cut", durationMinutes: 30 }],
    staff: [],
    policies: [],
    publishedFacts: ["Walk-ins are welcome."],
    unknownTopics: [],
    calendar: { provider: "calcom" },
    calendarNoteMode: "summary",
    enabledFeatures: ["booking"],
    inboundNumbers: [],
    callingWindow: { tz: "UTC", startHour: 8, endHour: 20, skipSunday: false },
    maxConcurrentCalls: 1,
    outboundRatePerHour: 0,
    firstCampaignRequiresApproval: true,
    published: true,
    serviceStatus: "active",
  };
}

async function setup(Store: typeof MemoryStore = MemoryStore) {
  const store = new Store();
  await store.upsertClient(client());
  await store.upsertTenantFeatureEntitlements({
    clientId: "tenant_a",
    whatsappEnabled: true,
    autoMinuteBlocksEnabled: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  await store.upsertSubscription({
    id: "sub_a",
    clientId: "tenant_a",
    provider: "internal",
    planTier: "pro",
    status: "active",
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    metadata: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  return store;
}

async function inbound(
  store: MemoryStore,
  id: string,
  body: string,
  window = "2026-09-18T12:00:00.000Z",
) {
  let session = await store.getMessageSession("tenant_a", "session_a");
  if (!session) {
    session = {
      id: "session_a",
      clientId: "tenant_a",
      channel: "whatsapp",
      contactAddress: "whatsapp:+447700900123",
      senderAddress: "whatsapp:+14155238886",
      status: "active",
      serviceWindowExpiresAt: window,
      state: {},
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    } satisfies MessageSession;
    await store.saveMessageSession(session);
  } else {
    session.serviceWindowExpiresAt = window;
    await store.saveMessageSession(session);
  }
  const event: MessageEvent = {
    id,
    clientId: "tenant_a",
    sessionId: session.id,
    channel: "whatsapp",
    direction: "inbound",
    provider: "twilio",
    providerMessageId: `SM_${id}`,
    idempotencyKey: `inbound:${id}`,
    status: "received",
    body,
    billableUnits: 0,
    metadata: { command: "message" },
    occurredAt: new Date(NOW.getTime() + Number(id.replace(/\D/g, "") || 0)).toISOString(),
    createdAt: NOW.toISOString(),
  };
  await store.appendMessageEvent(event);
}

afterEach(() => {
  delete process.env.WHATSAPP_BRAIN_MAX_TOOL_ITERATIONS;
  delete process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID;
  delete process.env.WHATSAPP_OUTSIDE_WINDOW_CONTENT_SID;
  delete process.env.PLAN_PRO_INCLUDED_MESSAGES;
});

describe("durable WhatsApp messaging brain", () => {
  it("persists compact multi-turn state and processes each event once", async () => {
    const store = await setup();
    const seen: string[][] = [];
    const llm: LlmDriver = {
      complete: vi.fn(async (args: Parameters<LlmDriver["complete"]>[0]) => {
        seen.push(args.messages.flatMap((message) =>
          "content" in message && typeof message.content === "string" ? [message.content] : []));
        return { toolCalls: [], text: seen.length === 1 ? "First reply" : "Second reply" };
      }),
    };
    await inbound(store, "event_1", "Hello");
    await processInboundWhatsAppMessages({ store, workerId: "worker", now: NOW, dependencies: { llm } });
    await inbound(store, "event_2", "And prices?");
    await processInboundWhatsAppMessages({ store, workerId: "worker", now: NOW, dependencies: { llm } });
    await processInboundWhatsAppMessages({ store, workerId: "worker", now: NOW, dependencies: { llm } });

    expect(seen[1]).toEqual(expect.arrayContaining(["Hello", "First reply", "And prices?"]));
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(await store.listNotifications("tenant_a")).toHaveLength(2);
    const session = await store.getMessageSession("tenant_a", "session_a");
    expect((session?.state.conversation as unknown[]).length).toBeLessThanOrEqual(12);
  });

  it("uses the knowledge seam and returns tool output to Groq-style turns", async () => {
    const store = await setup();
    const searchKnowledge = vi.fn().mockResolvedValue([{
      chunk: { id: "chunk", documentId: "doc", content: "Open until 6pm." },
      document: { id: "doc", title: "Approved FAQ" },
      score: 0.9,
    }]);
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: "tool_1", name: "search_knowledge", input: { query: "hours" } }] },
      { toolCalls: [], text: "The approved FAQ says the business is open until 6pm." },
    ]);
    await inbound(store, "event_1", "When do you close?");
    await processInboundWhatsAppMessages({
      store, workerId: "worker", now: NOW, dependencies: { llm, searchKnowledge },
    });
    expect(searchKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "tenant_a", query: "hours",
    }));
  });

  it("caps tool iterations", async () => {
    process.env.WHATSAPP_BRAIN_MAX_TOOL_ITERATIONS = "2";
    const store = await setup();
    const complete = vi.fn().mockResolvedValue({
      toolCalls: [{ id: "tool", name: "get_business_info", input: { topic: "services" } }],
    });
    await inbound(store, "event_1", "Help");
    await processInboundWhatsAppMessages({
      store, workerId: "worker", now: NOW, dependencies: { llm: { complete } },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect((await store.listNotifications("tenant_a"))[0]?.template).toMatch(/having trouble/i);
  });

  it("enforces the tenant feature and message allowance before calling the LLM", async () => {
    process.env.PLAN_PRO_INCLUDED_MESSAGES = "0";
    const store = await setup();
    const complete = vi.fn();
    await inbound(store, "event_1", "Hello");
    const result = await processInboundWhatsAppMessages({
      store, workerId: "worker", now: NOW, dependencies: { llm: { complete } },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(1);
    expect((await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_event_1"))?.status)
      .toBe("processed");
  });

  it("suppresses free-form replies outside 24 hours without an approved template", async () => {
    const store = await setup();
    await inbound(store, "event_1", "Hello", "2026-09-17T11:59:59.000Z");
    const result = await processInboundWhatsAppMessages({
      store,
      workerId: "worker",
      now: NOW,
      dependencies: { llm: new ScriptedLlm([{ toolCalls: [], text: "Free form" }]) },
    });
    expect(result.suppressed).toBe(1);
    expect(await store.listNotifications("tenant_a")).toHaveLength(0);
    expect((await store.listMessageEvents("tenant_a", "session_a"))
      .find((event) => event.direction === "outbound")?.status).toBe("suppressed");
  });

  it("keeps a successful booking when confirmation enqueue fails", async () => {
    class BookingNotificationFailureStore extends MemoryStore {
      override async enqueueNotification(delivery: NotificationDelivery) {
        if (delivery.idempotencyKey.startsWith("whatsapp:booking:")) {
          throw new Error("notification_outbox_unavailable");
        }
        return super.enqueueNotification(delivery);
      }
    }
    process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID = "HXapproved";
    const store = await setup(BookingNotificationFailureStore);
    const calendar = new FakeCalendar();
    const llm = new ScriptedLlm([
      {
        toolCalls: [{
          id: "book",
          name: "create_booking",
          input: {
            eventTypeSlug: "cut",
            start: "2026-09-18T10:00:00.000Z",
            attendeeName: "Sam",
            attendeePhone: "+447700900123",
            callerConfirmed: true,
            idempotencyKey: "model-key",
          },
        }],
      },
      { toolCalls: [], text: "Booked." },
    ]);
    await inbound(store, "event_1", "Yes, book it");
    const result = await processInboundWhatsAppMessages({
      store, workerId: "worker", now: NOW, dependencies: { llm, calendar },
    });
    expect(result.processed).toBe(1);
    expect(calendar.bookings.size).toBe(1);
    expect((await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_event_1"))?.status)
      .toBe("processed");
    expect(await store.listNotifications("tenant_a")).toHaveLength(1);
  });
});
