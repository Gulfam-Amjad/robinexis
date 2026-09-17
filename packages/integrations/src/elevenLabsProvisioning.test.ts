import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NO_TRANSFER_FALLBACK_PROMPT,
  ElevenLabsHttpError,
  ElevenLabsManagementClient,
  ElevenLabsNetworkError,
  ElevenLabsTimeoutError,
  ElevenLabsValidationError,
  IMMEDIATE_HUMAN_REQUEST_CONDITION,
  buildElevenLabsAgentConfig,
  provisionElevenLabsAgent,
  type ElevenLabsAgentConfig,
} from "./elevenLabsProvisioning.js";

const operationKey = "customer-onboarding-42";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseConfig(): ElevenLabsAgentConfig {
  return buildElevenLabsAgentConfig({
    name: "Receptionist",
    firstMessage: "Hello, how can I help?",
    systemPrompt: "Be helpful.",
    externalOperationKey: operationKey,
  }).agentConfig;
}

describe("buildElevenLabsAgentConfig", () => {
  it("builds a conference transfer with immediate human-request handling and messages", () => {
    const result = buildElevenLabsAgentConfig({
      name: "  Receptionist  ",
      firstMessage: "  Hello  ",
      systemPrompt: "Help the caller.",
      externalOperationKey: operationKey,
      tags: ["production", "production"],
      voiceId: "voice_123",
      language: "en",
      transfer: {
        phoneNumber: "+442079460123",
        callerHoldMessage: "Please hold while I connect you.",
        humanOperatorSummaryMessage: "A caller needs human assistance.",
      },
    });

    const agent = result.agentConfig.conversation_config.agent;
    const tool = agent.prompt.built_in_tools?.transfer_to_number;
    expect(result.fallbackPrompt).toBeUndefined();
    expect(result.agentConfig.name).toBe("Receptionist");
    expect(result.agentConfig.tags).toEqual([
      "production",
      `external-operation:${operationKey}`,
    ]);
    expect(result.agentConfig.conversation_config.tts).toEqual({
      voice_id: "voice_123",
      model_id: "eleven_flash_v2_5",
    });
    expect(result.agentConfig.conversation_config.turn).toEqual({
      turn_timeout: 7,
      silence_end_call_timeout: 12,
    });
    expect(agent.language).toBe("en");
    expect(tool?.params.transfers).toEqual([
      {
        transfer_destination: { type: "phone", phone_number: "+442079460123" },
        condition: IMMEDIATE_HUMAN_REQUEST_CONDITION,
        transfer_type: "conference",
      },
    ]);
    expect(tool?.params.enable_client_message).toBe(true);
    expect(agent.prompt.prompt).toContain('client_message exactly "Please hold while I connect you."');
    expect(agent.prompt.prompt).toContain(
      'agent_message exactly "A caller needs human assistance."',
    );
    expect(agent.prompt.prompt).toContain("Call transfer_to_number immediately");
  });

  it("leaves premium tenants on the live voice model without cheap timeouts", () => {
    const result = buildElevenLabsAgentConfig({
      name: "Blades receptionist",
      firstMessage: "Hello",
      systemPrompt: "Help.",
      externalOperationKey: operationKey,
      voiceId: "voice_blades",
      costOptimized: false,
    });
    expect(result.agentConfig.conversation_config.tts).toEqual({ voice_id: "voice_blades" });
    expect(result.agentConfig.conversation_config.turn).toBeUndefined();
    expect(result.agentConfig.conversation_config.conversation).toBeUndefined();
  });

  it("honours an explicit condition and transfer type", () => {
    const result = buildElevenLabsAgentConfig({
      name: "Receptionist",
      firstMessage: "Hello",
      systemPrompt: "Help.",
      externalOperationKey: operationKey,
      transfer: {
        phoneNumber: "+14155552671",
        condition: "When a safety issue needs escalation.",
        transferType: "blind",
        callerHoldMessage: "I will connect you now.",
        humanOperatorSummaryMessage: "Safety escalation.",
      },
    });

    expect(
      result.agentConfig.conversation_config.agent.prompt.built_in_tools
        ?.transfer_to_number.params.transfers[0],
    ).toMatchObject({
      condition: "When a safety issue needs escalation.",
      transfer_type: "blind",
    });
  });

  it("attaches only the tenant's newly created tool ids", () => {
    const result = buildElevenLabsAgentConfig({
      name: "Receptionist",
      firstMessage: "Hello",
      systemPrompt: "Help.",
      externalOperationKey: operationKey,
      toolIds: ["tool_availability", "tool_booking"],
    });
    expect(result.agentConfig.conversation_config.agent.prompt.tool_ids).toEqual([
      "tool_availability",
      "tool_booking",
    ]);
  });

  it("omits the transfer tool and returns a fallback prompt when no number is supplied", () => {
    const result = buildElevenLabsAgentConfig({
      name: "Receptionist",
      firstMessage: "Hello",
      systemPrompt: "Help.",
      externalOperationKey: operationKey,
    });

    expect(
      result.agentConfig.conversation_config.agent.prompt.built_in_tools,
    ).toBeUndefined();
    expect(result.fallbackPrompt).toBe(DEFAULT_NO_TRANSFER_FALLBACK_PROMPT);
    expect(result.agentConfig.conversation_config.agent.prompt.prompt).toContain(
      DEFAULT_NO_TRANSFER_FALLBACK_PROMPT,
    );
  });

  it("returns and installs a caller-provided fallback prompt", () => {
    const fallback = "Take a message and say the team will call back.";
    const result = buildElevenLabsAgentConfig({
      name: "Receptionist",
      firstMessage: "Hello",
      systemPrompt: "Help.",
      externalOperationKey: operationKey,
      noTransferFallbackPrompt: fallback,
    });

    expect(result.fallbackPrompt).toBe(fallback);
    expect(result.agentConfig.conversation_config.agent.prompt.prompt).toContain(fallback);
  });

  it.each(["020 7946 0123", "+0123456789", "+123", "+1234567890123456"])(
    "rejects non-E.164 transfer number %s",
    (phoneNumber) => {
      expect(() =>
        buildElevenLabsAgentConfig({
          name: "Receptionist",
          firstMessage: "Hello",
          systemPrompt: "Help.",
          externalOperationKey: operationKey,
          transfer: {
            phoneNumber,
            callerHoldMessage: "Please hold.",
            humanOperatorSummaryMessage: "Caller summary.",
          },
        }),
      ).toThrow(ElevenLabsValidationError);
    },
  );

  it("rejects missing transfer messages and unsafe operation keys", () => {
    expect(() =>
      buildElevenLabsAgentConfig({
        name: "Receptionist",
        firstMessage: "Hello",
        systemPrompt: "Help.",
        externalOperationKey: operationKey,
        transfer: {
          phoneNumber: "+442079460123",
          callerHoldMessage: "",
          humanOperatorSummaryMessage: "Summary.",
        },
      }),
    ).toThrow(/callerHoldMessage/);

    expect(() =>
      buildElevenLabsAgentConfig({
        name: "Receptionist",
        firstMessage: "Hello",
        systemPrompt: "Help.",
        externalOperationKey: "contains spaces",
      }),
    ).toThrow(ElevenLabsValidationError);
  });
});

describe("ElevenLabsManagementClient", () => {
  it("creates an agent with authentication and idempotency headers", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ agent_id: "agent_new" }));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-api-key",
      baseUrl: "https://example.test/",
      fetch: fetchMock,
    });
    const config = baseConfig();

    await expect(client.createAgent(config, operationKey)).resolves.toEqual({
      agent_id: "agent_new",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/v1/convai/agents/create");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": "test-api-key",
        "Idempotency-Key": operationKey,
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual(config);
  });

  it("updates an explicitly identified agent without first reading a live agent", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ agent_id: "agent_existing" }));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await client.updateAgent("agent/existing", baseConfig(), operationKey);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.elevenlabs.io/v1/convai/agents/agent%2Fexisting",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });

  it("creates an isolated workspace secret and webhook tool", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ type: "stored", secret_id: "secret_new", name: "tenant-tool" }))
      .mockResolvedValueOnce(jsonResponse({ tool_id: "tool_new" }));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await expect(
      client.createWorkspaceSecret("tenant-tool", "raw-secret", operationKey),
    ).resolves.toMatchObject({ secret_id: "secret_new" });
    await expect(
      client.createTool({ type: "webhook", name: "check_availability" }, operationKey),
    ).resolves.toEqual({ tool_id: "tool_new" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.elevenlabs.io/v1/convai/secrets");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      type: "new",
      name: "tenant-tool",
      value: "raw-secret",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.elevenlabs.io/v1/convai/tools");
  });

  it("imports an SK Twilio number with signature token, assigns it, and deletes it", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ phone_number_id: "phone_new" }))
      .mockResolvedValueOnce(jsonResponse({ phone_number_id: "phone_existing" }))
      .mockResolvedValueOnce(jsonResponse({}));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await client.importTwilioNumber(
      {
        phoneNumber: "+442079460123",
        label: "Main line",
        accountSid: "SK-test",
        authToken: "twilio-api-key-secret",
        accountAuthToken: "twilio-account-auth-token",
        agentId: "agent_1",
      },
      operationKey,
    );
    await client.assignAgentToPhoneNumber("phone/1", "agent_2", operationKey);
    await client.deletePhoneNumber("phone/1", operationKey);

    const importBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.elevenlabs.io/v1/convai/phone-numbers",
    );
    expect(importBody).toEqual({
      provider: "twilio",
      phone_number: "+442079460123",
      label: "Main line",
      sid: "SK-test",
      token: "twilio-api-key-secret",
      account_auth_token: "twilio-account-auth-token",
      agent_id: "agent_1",
      enable_sms: false,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.elevenlabs.io/v1/convai/phone-numbers/phone%2F1",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      agent_id: "agent_2",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.elevenlabs.io/v1/convai/phone-numbers/phone%2F1",
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBeUndefined();
  });

  it("returns a typed HTTP error with parsed details and retryability", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ detail: "rate limited" }, 429));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    const error = await client
      .createAgent(baseConfig(), operationKey)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ElevenLabsHttpError);
    expect(error).toMatchObject({
      status: 429,
      responseBody: { detail: "rate limited" },
      retryable: true,
      code: "elevenlabs_http_error",
    });
  });

  it("returns a typed network error", async () => {
    const cause = new TypeError("socket failed");
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(cause);
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    const error = await client
      .createAgent(baseConfig(), operationKey)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ElevenLabsNetworkError);
    expect(error).toMatchObject({ cause, retryable: true });
  });

  it("aborts slow requests and returns a typed timeout error", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      timeoutMs: 5,
      fetch: fetchMock,
    });

    const error = await client
      .createAgent(baseConfig(), operationKey)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ElevenLabsTimeoutError);
    expect(error).toMatchObject({ timeoutMs: 5, retryable: true });
  });
});

describe("provisionElevenLabsAgent", () => {
  it("creates an agent and imports a Twilio number already assigned to it", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ agent_id: "agent_new" }))
      .mockResolvedValueOnce(jsonResponse({ phone_number_id: "phone_new" }));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await expect(
      provisionElevenLabsAgent(client, {
        config: baseConfig(),
        externalOperationKey: operationKey,
        twilioNumber: {
          phoneNumber: "+442079460123",
          label: "Main",
          accountSid: "AC-test",
          authToken: "token-test",
        },
      }),
    ).resolves.toEqual({
      agentId: "agent_new",
      agentAction: "created",
      phoneNumberId: "phone_new",
      phoneAction: "imported",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      agent_id: "agent_new",
    });
  });

  it("updates a supplied agent and assigns an existing imported Twilio number", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ agent_id: "agent_existing" }))
      .mockResolvedValueOnce(jsonResponse({ phone_number_id: "phone_existing" }));
    const client = new ElevenLabsManagementClient({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await expect(
      provisionElevenLabsAgent(client, {
        config: baseConfig(),
        externalOperationKey: operationKey,
        existingAgentId: "agent_existing",
        existingPhoneNumberId: "phone_existing",
      }),
    ).resolves.toEqual({
      agentId: "agent_existing",
      agentAction: "updated",
      phoneNumberId: "phone_existing",
      phoneAction: "assigned",
    });

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["PATCH", "PATCH"]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.elevenlabs.io/v1/convai/agents/agent_existing",
      "https://api.elevenlabs.io/v1/convai/phone-numbers/phone_existing",
    ]);
  });
});

describe("ElevenLabs account subscription connector", () => {
  it("uses the official subscription endpoint and returns sanitized fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      tier: "creator",
      status: "active",
      character_count: 100,
      character_limit: 1000,
      next_character_count_reset_unix: 1_800_000_000,
      can_extend_character_limit: true,
      api_key: "must-not-leak",
    }));
    const client = new ElevenLabsManagementClient({ apiKey: "test-key", fetch: fetchMock });
    await expect(client.getSubscription()).resolves.toEqual({
      tier: "creator",
      status: "active",
      characterCount: 100,
      characterLimit: 1000,
      nextResetUnix: 1_800_000_000,
      canExtendCharacterLimit: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/user/subscription",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
