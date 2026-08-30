import {
  BrainSession,
  ScriptedLlm,
  accumulateGroqStream,
  compilePrompt,
  greetingFor,
  noteFromCall,
  toGroqMessages,
  turnFromGroqMessage,
  type LlmDriver,
} from "@robinexis/brain";
import {
  MemoryStore,
  RedisSessionCache,
  isAiServiceEnabled,
  isGroqGatewayPipeline,
  newId,
  redactSecrets,
  seedStore,
  stripeStatusToLocal,
  type CallSession,
} from "@robinexis/database";
import {
  FakeCalendar,
  applyOutboundStatus,
  assertDemoTenant,
  createToolExecutor,
  demoOutboundFrom,
  finishCall,
  inCallingWindow,
  isValidE164,
  LIVE_SALON_NUMBER,
  maskCalcomUsername,
  publicCalcomProbe,
  publicClientView,
  publicDemoCallView,
  sandboxFromIsLiveSalon,
  startSandboxDemoCall,
  validateTwilioWebhook,
} from "@robinexis/integrations";
import { describe, expect, it } from "vitest";

function emptyCall(clientId: string, promptVersionId: string): CallSession {
  const now = new Date().toISOString();
  return {
    id: newId("call_"),
    clientId,
    direction: "inbound",
    objective: "Book or help the caller",
    promptVersionId,
    transcript: [],
    collected: {},
    toolHistory: [],
    state: "greeting",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

describe("prompt compiler", () => {
  it("assembles identity, tools, safety, and inbound vs outbound", async () => {
    const { client } = await seedStore(new MemoryStore());
    const inbound = compilePrompt({ client, direction: "inbound", objective: "receptionist" });
    expect(inbound).toMatch(/Smith England/);
    expect(inbound).toMatch(/check_availability/);
    expect(inbound).toMatch(/never invent/i);
    expect(inbound).toMatch(/INBOUND/);
    const outbound = compilePrompt({ client, direction: "outbound", objective: "appointment-reminder" });
    expect(outbound).toMatch(/OUTBOUND/);
    expect(outbound).toMatch(/voicemail/);
  });
});

describe("access control", () => {
  it("maps Stripe statuses and gates outbound on past_due", async () => {
    expect(stripeStatusToLocal("active")).toBe("active");
    const { client } = await seedStore(new MemoryStore());
    client.serviceStatus = "canceled";
    expect(isAiServiceEnabled(client).inbound).toBe(false);
    client.serviceStatus = "past_due";
    client.pastDueAt = new Date().toISOString();
    const g = isAiServiceEnabled(client);
    expect(g.outbound).toBe(false);
    expect(g.inbound).toBe(true);
  });

  it("redacts secrets from logs", () => {
    const out = redactSecrets({ Authorization: "Bearer cal_live_abc", note: "ok" }) as Record<string, unknown>;
    expect(out.Authorization).toBe("[redacted]");
    expect(out.note).toBe("ok");
  });
});

describe("text brain + fake calendar", () => {
  it("does not invent slots — only offers tool results", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const cal = new FakeCalendar(["2026-09-01T10:00:00.000Z"]);
    const exec = createToolExecutor({ store, calendar: cal });
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          {
            id: "1",
            name: "check_availability",
            input: {
              eventTypeSlug: "haircut-style",
              start: "2026-09-01T00:00:00.000Z",
              end: "2026-09-02T00:00:00.000Z",
            },
          },
        ],
      },
      { toolCalls: [], text: "I have 10am on 1 September free. Would that work?" },
    ]);
    const session = new BrainSession(llm, exec, client, emptyCall(client.id, prompt.id), greetingFor(client));
    const r1 = await session.handleUserTurn("Do you have anything Tuesday?");
    expect(r1.type).toBe("speak");
    if (r1.type === "speak") {
      expect(r1.text).toMatch(/10am/);
      expect(r1.text).not.toMatch(/3pm/);
    }
    expect(session.getCall().toolHistory[0]?.name).toBe("check_availability");
  });

  it("blocks booking without caller confirmation and is idempotent after confirm", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const cal = new FakeCalendar();
    const exec = createToolExecutor({ store, calendar: cal });
    const denied = await exec({
      name: "create_booking",
      input: {
        eventTypeSlug: "haircut-style",
        start: "2026-09-01T10:00:00.000Z",
        attendeeName: "Alex",
        attendeeEmail: "alex@example.com",
        idempotencyKey: "k1",
        callerConfirmed: false,
      },
      call: emptyCall(client.id, prompt.id),
      client,
    });
    expect(denied.ok).toBe(false);

    const call = emptyCall(client.id, prompt.id);
    const first = await exec({
      name: "create_booking",
      input: {
        eventTypeSlug: "haircut-style",
        start: "2026-09-01T10:00:00.000Z",
        attendeeName: "Alex",
        attendeeEmail: "alex@example.com",
        idempotencyKey: "book-1",
        callerConfirmed: true,
      },
      call,
      client,
    });
    const second = await exec({
      name: "create_booking",
      input: {
        eventTypeSlug: "haircut-style",
        start: "2026-09-01T10:00:00.000Z",
        attendeeName: "Alex",
        attendeeEmail: "alex@example.com",
        idempotencyKey: "book-1",
        callerConfirmed: true,
      },
      call,
      client,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.data).toEqual(first.data);
  });

  it("unknown prices hand off honestly via get_business_info", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const exec = createToolExecutor({ store, calendar: new FakeCalendar() });
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: "1", name: "get_business_info", input: { topic: "prices" } }] },
      { toolCalls: [], text: "I don't have published prices — I'll have someone from the team confirm that." },
    ]);
    const session = new BrainSession(llm, exec, client, emptyCall(client.id, prompt.id));
    const r = await session.handleUserTurn("How much is a cut?");
    expect(r.type).toBe("speak");
    if (r.type === "speak") expect(r.text.toLowerCase()).toMatch(/confirm|don't have|not/);
  });

  it("transfer_to_human returns transfer result", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const exec = createToolExecutor({ store });
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: "1", name: "transfer_to_human", input: { reason: "caller asked for a person" } }] },
    ]);
    const session = new BrainSession(llm, exec, client, emptyCall(client.id, prompt.id));
    const r = await session.handleUserTurn("Put me through to the salon");
    expect(r).toEqual({ type: "transfer", reason: "caller asked for a person" });
  });

  it("reschedule and cancel require confirmation; DNC suppresses jobs", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const cal = new FakeCalendar();
    const exec = createToolExecutor({ store, calendar: cal });
    const call = emptyCall(client.id, prompt.id);
    const booked = await exec({
      name: "create_booking",
      input: {
        eventTypeSlug: "blow-dry",
        start: "2026-09-01T10:00:00.000Z",
        attendeeName: "Sam",
        attendeeEmail: "sam@example.com",
        callerConfirmed: true,
        idempotencyKey: "b2",
      },
      call,
      client,
    });
    expect(booked.ok).toBe(true);
    const uid = booked.ok ? (booked.data as { uid: string }).uid : "";
    const bad = await exec({
      name: "cancel_booking",
      input: { bookingUid: uid, summaryRepeated: "blow dry 10am", callerConfirmed: false, idempotencyKey: "c0" },
      call,
      client,
    });
    expect(bad.ok).toBe(false);
    const ok = await exec({
      name: "cancel_booking",
      input: { bookingUid: uid, summaryRepeated: "blow dry 10am", callerConfirmed: true, idempotencyKey: "c1" },
      call,
      client,
    });
    expect(ok.ok).toBe(true);

    await store.saveJob({
      id: "job1",
      clientId: client.id,
      campaign: "appointment-reminder",
      contactPhone: "+447700900000",
      purpose: "reminder",
      scheduledAt: "2020-01-01T00:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      status: "approved",
      approved: true,
    });
    await exec({
      name: "record_do_not_call",
      input: { phone: "+447700900000", reason: "opt-out" },
      call,
      client,
    });
    expect(await store.isSuppressed(client.id, "+447700900000")).toBe(true);
    const job = await store.getJob("job1");
    expect(job?.status).toBe("suppressed");
  });

  it("post-call notes append without putting full transcript on calendar by default", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const cal = new FakeCalendar();
    const exec = createToolExecutor({ store, calendar: cal });
    const call = emptyCall(client.id, prompt.id);
    await exec({
      name: "create_booking",
      input: {
        eventTypeSlug: "haircut-style",
        start: "2026-09-01T10:00:00.000Z",
        attendeeName: "Jo",
        attendeeEmail: "jo@example.com",
        callerConfirmed: true,
        idempotencyKey: "n1",
      },
      call,
      client,
    });
    call.transcript.push({ role: "caller", text: "card 4111111111111111", at: new Date().toISOString() });
    const note = noteFromCall(call);
    expect(note.crmSummary).not.toMatch(/4111111111111111/);
    await finishCall({ store, call, client, calendar: cal });
    expect(cal.notes[call.appointmentId ?? ""]).toBeTruthy();
    expect(cal.notes[call.appointmentId ?? ""]).not.toMatch(/4111/);
  });
});

describe("isolation + compliance", () => {
  it("rejects tools when call.clientId does not match client", async () => {
    const store = new MemoryStore();
    const a = await seedStore(store);
    const exec = createToolExecutor({ store, calendar: new FakeCalendar() });
    const call = emptyCall("other-tenant", a.prompt.id);
    const r = await exec({
      name: "get_business_info",
      input: {},
      call,
      client: a.client,
    });
    expect(r.ok).toBe(false);
  });

  it("UK calling window skips Sunday", () => {
    const client = {
      callingWindow: { tz: "UTC", startHour: 0, endHour: 24, skipSunday: true },
    } as never;
    const sunday = new Date("2026-08-30T12:00:00.000Z"); // Sunday
    expect(inCallingWindow(client, sunday)).toBe(false);
  });
});

describe("Groq provider mapping and cancellation", () => {
  it("maps provider-neutral tool calls to and from Groq messages", () => {
    const messages = toGroqMessages("system", [
      { role: "user", content: "book me" },
      {
        role: "assistant",
        toolCalls: [{ id: "tool-1", name: "check_availability", input: { start: "tomorrow" } }],
      },
      { role: "tool", toolCallId: "tool-1", content: JSON.stringify({ slots: ["10:00"] }) },
    ]);
    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "tool-1" }] });
    const turn = turnFromGroqMessage({
      content: null,
      tool_calls: [{
        id: "tool-2",
        type: "function",
        function: { name: "create_booking", arguments: '{"callerConfirmed":true}' },
      }],
    }, "tool_calls");
    expect(turn.toolCalls[0]).toMatchObject({
      id: "tool-2",
      name: "create_booking",
      input: { callerConfirmed: true },
    });
  });

  it("accumulates streamed text and fragmented Groq tool calls", async () => {
    async function* chunks() {
      yield {
        choices: [{
          delta: { content: "Let me check. " },
          finish_reason: null,
          index: 0,
        }],
      };
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "tool-stream",
              type: "function",
              function: { name: "check_availability", arguments: "{\"start\":" },
            }],
          },
          finish_reason: null,
          index: 0,
        }],
      };
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: "\"tomorrow\"}" },
            }],
          },
          finish_reason: "tool_calls",
          index: 0,
        }],
      };
    }
    const text: string[] = [];
    let toolStarted = 0;
    const turn = await accumulateGroqStream(chunks() as never, {
      onTextDelta: (delta) => text.push(delta),
      onToolCallStart: () => toolStarted++,
    });
    expect(text.join("")).toBe("Let me check. ");
    expect(toolStarted).toBe(1);
    expect(turn).toMatchObject({
      text: "Let me check.",
      stopReason: "tool_calls",
      toolCalls: [{
        id: "tool-stream",
        name: "check_availability",
        input: { start: "tomorrow" },
      }],
    });
  });

  it("streams the post-tool answer and cancels optimistic pre-tool speech", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const exec = createToolExecutor({
      store,
      calendar: new FakeCalendar(["2026-09-01T10:00:00.000Z"]),
    });
    let iteration = 0;
    const llm: LlmDriver = {
      async complete(args) {
        iteration++;
        if (iteration === 1) {
          args.stream?.onTextDelta?.("Let me check. ");
          args.stream?.onToolCallStart?.();
          return {
            toolCalls: [{
              id: "availability-1",
              name: "check_availability",
              input: {
                eventTypeSlug: "haircut-style",
                start: "2026-09-01T00:00:00.000Z",
                end: "2026-09-02T00:00:00.000Z",
              },
            }],
          };
        }
        args.stream?.onTextDelta?.("I have 10am available.");
        return { toolCalls: [], text: "I have 10am available." };
      },
    };
    const deltas: string[] = [];
    let cancellations = 0;
    const session = new BrainSession(
      llm,
      exec,
      client,
      emptyCall(client.id, prompt.id),
      greetingFor(client),
    );
    const result = await session.handleUserTurn("Tomorrow?", {
      onTextDelta: (text) => deltas.push(text),
      onSpeakCancel: () => cancellations++,
    });

    expect(cancellations).toBe(1);
    expect(deltas).toEqual(["Let me check. ", "I have 10am available."]);
    expect(result).toEqual({ type: "speak", text: "I have 10am available." });
    expect(session.getCall().toolHistory[0]?.name).toBe("check_availability");
  });

  it("freezes the system prompt for a live call and aborts in-flight generation", async () => {
    const store = new MemoryStore();
    const { client, prompt } = await seedStore(store);
    const call = emptyCall(client.id, prompt.id);
    let capturedSystem = "";
    const llm: LlmDriver = {
      complete: ({ system, signal }) =>
        new Promise((resolve, reject) => {
          capturedSystem = system;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          setTimeout(() => resolve({ text: "late", toolCalls: [] }), 100);
        }),
    };
    const frozen = "frozen published prompt";
    const session = new BrainSession(
      llm,
      createToolExecutor({ store, calendar: new FakeCalendar() }),
      client,
      call,
      undefined,
      frozen,
    );
    const result = session.handleUserTurn("my card is 4111111111111111");
    session.abortTurn();
    await expect(result).resolves.toEqual({ type: "aborted" });
    expect(capturedSystem).toBe(frozen);
    expect(call.transcript[0]?.text).toContain("[card redacted]");
  });
});

describe("distributed call and outbound controls", () => {
  it("enforces call reservations and releases capacity", async () => {
    const redis = new RedisSessionCache();
    expect(await redis.reserveCallSlot("a", "one", 1)).toBe(true);
    expect(await redis.reserveCallSlot("a", "two", 1)).toBe(false);
    expect(await redis.reserveCallSlot("b", "tenant-b", 1)).toBe(true);
    expect(await redis.activeCallCount("a")).toBe(1);
    expect(await redis.activeCallCount("b")).toBe(1);
    await redis.releaseCallSlot("a", "one");
    expect(await redis.reserveCallSlot("a", "two", 1)).toBe(true);
  });

  it("moves outbound statuses to retry, final and voicemail dispositions", () => {
    const base = {
      id: "j1",
      clientId: "c1",
      campaign: "appointment-reminder" as const,
      contactPhone: "+447700900000",
      purpose: "reminder",
      scheduledAt: "2026-08-29T08:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      status: "dialing" as const,
      approved: true,
    };
    expect(applyOutboundStatus({ ...base }, { callStatus: "no-answer" }).status).toBe("approved");
    expect(
      applyOutboundStatus({ ...base }, { callStatus: "completed", answeredBy: "machine_end_beep" })
        .disposition,
    ).toBe("voicemail");
    expect(
      applyOutboundStatus({ ...base, attemptCount: 3 }, { callStatus: "busy" }).status,
    ).toBe("failed");
  });

  it("rejects an invalid signed Twilio webhook", () => {
    const previous = process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    expect(validateTwilioWebhook("invalid", "https://example.com/twiml", { CallSid: "CA1" })).toBe(false);
    if (previous === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previous;
  });
});

describe("dual pipeline and demo call", () => {
  it("keeps Smith England on elevenlabs-convai and demo on groq-gateway", async () => {
    const store = new MemoryStore();
    const { client, demo } = await seedStore(store);
    expect(client.voicePipeline).toBe("elevenlabs-convai");
    expect(client.inboundNumbers).toEqual([]);
    expect(isGroqGatewayPipeline(client)).toBe(false);
    expect(demo.id).toBe("robinexis-demo");
    expect(demo.voicePipeline).toBe("groq-gateway");
    expect(isGroqGatewayPipeline(demo)).toBe(true);
    expect(await store.getPublishedClient("robinexis-demo")).toMatchObject({ slug: "robinexis-demo" });
    expect(assertDemoTenant(client)).toBe(false);
    expect(assertDemoTenant(demo)).toBe(true);
  });

  it("rejects invalid phones and missing public URL for demo outbound", async () => {
    const store = new MemoryStore();
    const { demo } = await seedStore(store);
    expect(isValidE164("923001234567")).toBe(false);
    expect(isValidE164("+923001234567")).toBe(true);
    const bad = await startSandboxDemoCall({ phone: "not-a-number", client: demo });
    expect(bad).toEqual({ ok: false, error: "invalid_phone", status: 400 });
    const previousFrom = process.env.TWILIO_SANDBOX_PHONE_NUMBER;
    const previousPhone = process.env.TWILIO_PHONE_NUMBER;
    const previousBase = process.env.PUBLIC_BASE_URL;
    delete process.env.TWILIO_SANDBOX_PHONE_NUMBER;
    delete process.env.TWILIO_PHONE_NUMBER;
    expect(demoOutboundFrom()).toBe(LIVE_SALON_NUMBER);
    process.env.TWILIO_SANDBOX_PHONE_NUMBER = "+447446868067";
    delete process.env.PUBLIC_BASE_URL;
    const missingBase = await startSandboxDemoCall({ phone: "+441234567890", client: demo });
    expect(missingBase).toMatchObject({ ok: false, error: "public_base_url_not_configured" });
    process.env.PUBLIC_BASE_URL = "https://example.ngrok.io";
    const placeholderBase = await startSandboxDemoCall({ phone: "+441234567890", client: demo });
    expect(placeholderBase).toMatchObject({ ok: false, error: "public_base_url_not_configured" });
    if (previousFrom === undefined) delete process.env.TWILIO_SANDBOX_PHONE_NUMBER;
    else process.env.TWILIO_SANDBOX_PHONE_NUMBER = previousFrom;
    if (previousPhone === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = previousPhone;
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
  });

  it("looks up demo calls by Twilio SID and redacts to the public lab view", async () => {
    const store = new MemoryStore();
    const { demo } = await seedStore(store);
    const call = emptyCall(demo.id, demo.promptVersionId ?? "pv");
    call.twilioCallSid = "CA123sandbox";
    call.transcript = [{ role: "agent", text: "Hello", at: new Date().toISOString() }];
    call.toolHistory = [{ name: "get_business_info", input: {}, result: { ok: true }, at: new Date().toISOString() }];
    await store.saveCall(call);
    expect(await store.getCallByTwilioSid(demo.id, "CA123sandbox")).toMatchObject({ id: call.id });
    expect(await store.getCallByTwilioSid(demo.id, "CAmissing")).toBeUndefined();
    expect(publicDemoCallView(call)).toMatchObject({
      id: call.id,
      twilioCallSid: "CA123sandbox",
      transcript: call.transcript,
    });
    const previous = process.env.TWILIO_SANDBOX_PHONE_NUMBER;
    process.env.TWILIO_SANDBOX_PHONE_NUMBER = "+447446868067";
    expect(sandboxFromIsLiveSalon()).toBe(true);
    process.env.TWILIO_SANDBOX_PHONE_NUMBER = "+15555550199";
    expect(sandboxFromIsLiveSalon()).toBe(false);
    if (previous === undefined) delete process.env.TWILIO_SANDBOX_PHONE_NUMBER;
    else process.env.TWILIO_SANDBOX_PHONE_NUMBER = previous;
  });
});

describe("operator dashboard probes", () => {
  it("masks Cal.com usernames and never puts apiKey on the public probe", async () => {
    expect(maskCalcomUsername("hammadmuntazir512@gmail.com")).toBe("h***@gmail.com");
    expect(maskCalcomUsername("admin")).toBe("adm***");
    const probe = publicCalcomProbe({
      configured: true,
      username: "hammadmuntazir512@gmail.com",
      eventTypeSlug: "15min",
      slots: ["2026-09-02T10:00:00.000Z", "2026-09-01T09:00:00.000Z"],
    });
    expect(probe.ok).toBe(true);
    expect(probe.slotCount).toBe(2);
    expect(probe.nextSlots[0]).toBe("2026-09-01T09:00:00.000Z");
    expect(probe.usernameMasked).toBe("h***@gmail.com");
    expect(JSON.stringify(probe)).not.toMatch(/apiKey|cal_live_|hammadmuntazir512@gmail/);
    const missing = publicCalcomProbe({ configured: false, username: "", eventTypeSlug: "15min" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("calcom_not_configured");
    const store = new MemoryStore();
    const { demo } = await seedStore(store);
    const view = publicClientView(demo);
    expect(view.calendar.provider).toBe("calcom");
    expect(JSON.stringify(view)).not.toMatch(/credentialRef|apiKey/);
  });
});
