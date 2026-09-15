const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_TIMEOUT_MS = 10_000;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const OPERATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type TransferType = "conference" | "blind";

export interface HumanTransferInput {
  phoneNumber: string;
  condition?: string;
  transferType?: TransferType;
  callerHoldMessage: string;
  humanOperatorSummaryMessage: string;
}

export interface AgentConfigInput {
  name: string;
  firstMessage: string;
  systemPrompt: string;
  externalOperationKey: string;
  tags?: readonly string[];
  voiceId?: string;
  language?: string;
  toolIds?: readonly string[];
  transfer?: HumanTransferInput;
  noTransferFallbackPrompt?: string;
}

export interface TransferToNumberTool {
  type: "system";
  name: "transfer_to_number";
  description: string;
  params: {
    system_tool_type: "transfer_to_number";
    enable_client_message: true;
    transfers: Array<{
      transfer_destination: { type: "phone"; phone_number: string };
      condition: string;
      transfer_type: TransferType;
    }>;
  };
}

export interface ElevenLabsAgentConfig {
  name: string;
  tags: string[];
  conversation_config: {
    agent: {
      first_message: string;
      language?: string;
      prompt: {
        prompt: string;
        tool_ids?: string[];
        built_in_tools?: {
          transfer_to_number: TransferToNumberTool;
        };
      };
    };
    tts?: {
      voice_id: string;
    };
  };
}

export interface BuiltAgentConfig {
  agentConfig: ElevenLabsAgentConfig;
  fallbackPrompt?: string;
}

export const IMMEDIATE_HUMAN_REQUEST_CONDITION =
  "Immediately when the caller explicitly asks to speak to a human, person, receptionist, manager, or operator. Do not require troubleshooting first.";

export const DEFAULT_NO_TRANSFER_FALLBACK_PROMPT =
  "Human transfer is unavailable. Apologise, explain that you cannot connect the call, and offer to take a callback message or provide a published contact number. Never claim that a transfer is happening.";

export class ElevenLabsValidationError extends Error {
  readonly code = "elevenlabs_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "ElevenLabsValidationError";
  }
}

export class ElevenLabsHttpError extends Error {
  readonly code = "elevenlabs_http_error";
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    readonly responseBody: unknown,
    message = `ElevenLabs request failed with status ${status}`,
  ) {
    super(message);
    this.name = "ElevenLabsHttpError";
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export class ElevenLabsTimeoutError extends Error {
  readonly code = "elevenlabs_timeout";
  readonly retryable = true;

  constructor(readonly timeoutMs: number) {
    super(`ElevenLabs request timed out after ${timeoutMs}ms`);
    this.name = "ElevenLabsTimeoutError";
  }
}

export class ElevenLabsNetworkError extends Error {
  readonly code = "elevenlabs_network_error";
  readonly retryable = true;

  constructor(readonly cause: unknown) {
    super("ElevenLabs request failed before a response was received");
    this.name = "ElevenLabsNetworkError";
  }
}

export function assertE164(phoneNumber: string): void {
  if (!E164_PATTERN.test(phoneNumber)) {
    throw new ElevenLabsValidationError(
      `Phone number must use E.164 format (for example +442079460000): ${phoneNumber}`,
    );
  }
}

function assertOperationKey(operationKey: string): void {
  if (!OPERATION_KEY_PATTERN.test(operationKey)) {
    throw new ElevenLabsValidationError(
      "externalOperationKey must be 1-128 characters and contain only letters, numbers, '.', '_', ':', or '-'",
    );
  }
}

function appendInstruction(prompt: string, instruction: string): string {
  return `${prompt.trim()}\n\n${instruction}`;
}

/**
 * Builds a new tenant-neutral payload solely from approved input. It never reads
 * an existing/live agent and therefore cannot accidentally inherit another
 * tenant's prompt, tools, phone number, or credentials.
 */
export function buildElevenLabsAgentConfig(input: AgentConfigInput): BuiltAgentConfig {
  assertOperationKey(input.externalOperationKey);
  if (!input.name.trim() || !input.firstMessage.trim() || !input.systemPrompt.trim()) {
    throw new ElevenLabsValidationError("name, firstMessage, and systemPrompt are required");
  }

  const externalTag = `external-operation:${input.externalOperationKey}`;
  const tags = Array.from(new Set([...(input.tags ?? []), externalTag]));
  let prompt = input.systemPrompt.trim();
  let builtInTools: ElevenLabsAgentConfig["conversation_config"]["agent"]["prompt"]["built_in_tools"];
  let fallbackPrompt: string | undefined;

  if (input.transfer) {
    assertE164(input.transfer.phoneNumber);
    if (
      !input.transfer.callerHoldMessage.trim() ||
      !input.transfer.humanOperatorSummaryMessage.trim()
    ) {
      throw new ElevenLabsValidationError(
        "callerHoldMessage and humanOperatorSummaryMessage are required when transfer is enabled",
      );
    }

    const condition = input.transfer.condition?.trim() || IMMEDIATE_HUMAN_REQUEST_CONDITION;
    const transferType = input.transfer.transferType ?? "conference";
    const callerMessage = input.transfer.callerHoldMessage.trim();
    const operatorMessage = input.transfer.humanOperatorSummaryMessage.trim();
    const transferInstructions = [
      "HUMAN TRANSFER",
      `Call transfer_to_number immediately when this condition is met: ${condition}`,
      `Use transfer_number exactly "${input.transfer.phoneNumber}".`,
      `Use client_message exactly "${callerMessage}".`,
      `Use agent_message exactly "${operatorMessage}" and then add a concise summary of the caller's request when context is available.`,
    ].join("\n");
    prompt = appendInstruction(prompt, transferInstructions);
    builtInTools = {
      transfer_to_number: {
        type: "system",
        name: "transfer_to_number",
        description:
          "Immediately transfer an explicit request for a human. Supply the configured transfer_number, caller hold client_message, and human operator agent_message.",
        params: {
          system_tool_type: "transfer_to_number",
          enable_client_message: true,
          transfers: [
            {
              transfer_destination: {
                type: "phone",
                phone_number: input.transfer.phoneNumber,
              },
              condition,
              transfer_type: transferType,
            },
          ],
        },
      },
    };
  } else {
    fallbackPrompt =
      input.noTransferFallbackPrompt?.trim() || DEFAULT_NO_TRANSFER_FALLBACK_PROMPT;
    prompt = appendInstruction(prompt, `HUMAN TRANSFER FALLBACK\n${fallbackPrompt}`);
  }

  return {
    agentConfig: {
      name: input.name.trim(),
      tags,
      conversation_config: {
        agent: {
          first_message: input.firstMessage.trim(),
          ...(input.language ? { language: input.language } : {}),
          prompt: {
            prompt,
            ...(input.toolIds?.length ? { tool_ids: [...input.toolIds] } : {}),
            ...(builtInTools ? { built_in_tools: builtInTools } : {}),
          },
        },
        ...(input.voiceId ? { tts: { voice_id: input.voiceId } } : {}),
      },
    },
    ...(fallbackPrompt ? { fallbackPrompt } : {}),
  };
}

export interface CreateAgentResponse {
  agent_id: string;
}

export interface ImportTwilioNumberInput {
  phoneNumber: string;
  label: string;
  accountSid: string;
  authToken: string;
  accountAuthToken?: string;
  agentId?: string;
  enableSms?: boolean;
}

export interface ImportedPhoneNumber {
  phone_number_id: string;
  phone_number?: string;
  provider?: "twilio";
}

export interface StoredWorkspaceSecret {
  type: "stored";
  secret_id: string;
  name: string;
}

export interface CreatedTool {
  tool_id: string;
}

export interface ElevenLabsManagementClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class ElevenLabsManagementClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ElevenLabsManagementClientOptions) {
    if (!options.apiKey) {
      throw new ElevenLabsValidationError("An ElevenLabs API key is required");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  createAgent(
    config: ElevenLabsAgentConfig,
    operationKey: string,
  ): Promise<CreateAgentResponse> {
    return this.request("/v1/convai/agents/create", "POST", config, operationKey);
  }

  createWorkspaceSecret(
    name: string,
    value: string,
    operationKey: string,
  ): Promise<StoredWorkspaceSecret> {
    if (!name.trim() || !value) {
      throw new ElevenLabsValidationError("Workspace secret name and value are required");
    }
    return this.request(
      "/v1/convai/secrets",
      "POST",
      { type: "new", name: name.trim(), value },
      operationKey,
    );
  }

  createTool(config: Record<string, unknown>, operationKey: string): Promise<CreatedTool> {
    return this.request("/v1/convai/tools", "POST", config, operationKey);
  }

  updateAgent(
    agentId: string,
    config: ElevenLabsAgentConfig,
    operationKey: string,
  ): Promise<CreateAgentResponse | Record<string, unknown>> {
    return this.request(
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      "PATCH",
      config,
      operationKey,
    );
  }

  importTwilioNumber(
    input: ImportTwilioNumberInput,
    operationKey: string,
  ): Promise<ImportedPhoneNumber> {
    assertE164(input.phoneNumber);
    return this.request(
      "/v1/convai/phone-numbers",
      "POST",
      {
        provider: "twilio",
        phone_number: input.phoneNumber,
        label: input.label,
        sid: input.accountSid,
        token: input.authToken,
        ...(input.accountAuthToken ? { account_auth_token: input.accountAuthToken } : {}),
        ...(input.agentId ? { agent_id: input.agentId } : {}),
        enable_sms: input.enableSms ?? false,
      },
      operationKey,
    );
  }

  assignAgentToPhoneNumber(
    phoneNumberId: string,
    agentId: string,
    operationKey: string,
  ): Promise<ImportedPhoneNumber> {
    return this.request(
      `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`,
      "PATCH",
      { agent_id: agentId },
      operationKey,
    );
  }

  unassignAgentFromPhoneNumber(
    phoneNumberId: string,
    operationKey: string,
  ): Promise<ImportedPhoneNumber> {
    return this.request(
      `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`,
      "PATCH",
      { agent_id: null },
      operationKey,
    );
  }

  deletePhoneNumber(phoneNumberId: string, operationKey: string): Promise<Record<string, unknown>> {
    return this.request(
      `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`,
      "DELETE",
      undefined,
      operationKey,
    );
  }

  private async request<T>(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
    operationKey: string,
  ): Promise<T> {
    assertOperationKey(operationKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.options.apiKey,
          "Idempotency-Key": operationKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const responseBody = await parseResponseBody(response);
      if (!response.ok) {
        throw new ElevenLabsHttpError(response.status, responseBody);
      }
      return responseBody as T;
    } catch (error) {
      if (error instanceof ElevenLabsHttpError) throw error;
      if (controller.signal.aborted || isAbortError(error)) {
        throw new ElevenLabsTimeoutError(this.timeoutMs);
      }
      throw new ElevenLabsNetworkError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export interface ProvisionAgentInput {
  config: ElevenLabsAgentConfig;
  externalOperationKey: string;
  existingAgentId?: string;
  existingPhoneNumberId?: string;
  twilioNumber?: Omit<ImportTwilioNumberInput, "agentId">;
}

export interface ProvisionAgentResult {
  agentId: string;
  agentAction: "created" | "updated";
  phoneNumberId?: string;
  phoneAction?: "imported" | "assigned";
}

/**
 * Performs only write operations selected from caller-supplied state. Reusing
 * the same externalOperationKey, existing IDs, and config makes retries safe
 * for an orchestration layer without fetching a live agent as a template.
 */
export async function provisionElevenLabsAgent(
  client: ElevenLabsManagementClient,
  input: ProvisionAgentInput,
): Promise<ProvisionAgentResult> {
  let agentId = input.existingAgentId;
  let agentAction: ProvisionAgentResult["agentAction"];

  if (agentId) {
    await client.updateAgent(agentId, input.config, `${input.externalOperationKey}:agent`);
    agentAction = "updated";
  } else {
    const created = await client.createAgent(
      input.config,
      `${input.externalOperationKey}:agent`,
    );
    if (!created.agent_id) {
      throw new ElevenLabsHttpError(502, created, "ElevenLabs create response omitted agent_id");
    }
    agentId = created.agent_id;
    agentAction = "created";
  }

  if (input.existingPhoneNumberId) {
    await client.assignAgentToPhoneNumber(
      input.existingPhoneNumberId,
      agentId,
      `${input.externalOperationKey}:phone`,
    );
    return {
      agentId,
      agentAction,
      phoneNumberId: input.existingPhoneNumberId,
      phoneAction: "assigned",
    };
  }

  if (input.twilioNumber) {
    const imported = await client.importTwilioNumber(
      { ...input.twilioNumber, agentId },
      `${input.externalOperationKey}:phone`,
    );
    if (!imported.phone_number_id) {
      throw new ElevenLabsHttpError(
        502,
        imported,
        "ElevenLabs import response omitted phone_number_id",
      );
    }
    return {
      agentId,
      agentAction,
      phoneNumberId: imported.phone_number_id,
      phoneAction: "imported",
    };
  }

  return { agentId, agentAction };
}
