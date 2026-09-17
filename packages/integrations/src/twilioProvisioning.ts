import twilio from "twilio";

export const PROTECTED_TWILIO_NUMBER = "+447446868067";
export const PROTECTED_TWILIO_TENANT_IDS = new Set([
  "client_blades_hair",
  "blades-hair",
]);
export const PROTECTED_TWILIO_RESOURCE_IDS = new Set([
  "agent_6101m1c3n4wnfsgskgzr13w2gt9s",
]);

export interface TwilioNumber {
  phoneNumber: string;
  sid?: string;
}

export interface TwilioManagedSubaccount {
  sid: string;
  friendlyName: string;
  status?: string;
}

export interface TwilioAvailableNumber {
  phoneNumber: string;
  locality?: string;
  region?: string;
  capabilities?: Record<string, boolean>;
  monthlyPrice?: string;
}

export interface TwilioPurchasedNumber extends TwilioNumber {
  accountSid: string;
}

export interface TwilioManagementAdapter {
  findSubaccount(friendlyName: string): Promise<TwilioManagedSubaccount | undefined>;
  createSubaccount(friendlyName: string): Promise<TwilioManagedSubaccount>;
  searchAvailableNumbers(input: {
    accountSid: string;
    countryCode: string;
    type: "local" | "tollFree";
    areaCode?: string;
    contains?: string;
    limit?: number;
  }): Promise<TwilioAvailableNumber[]>;
  purchaseNumber(input: {
    accountSid: string;
    phoneNumber: string;
    friendlyName: string;
  }): Promise<TwilioPurchasedNumber>;
  configureNumber(input: {
    accountSid: string;
    numberSid: string;
    voiceUrl: string;
    statusCallbackUrl: string;
  }): Promise<void>;
}

export class TwilioHttpManagementAdapter implements TwilioManagementAdapter {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!accountSid || !authToken) throw new Error("twilio_not_configured");
  }

  private async call<T>(
    path: string,
    init: { method?: string; body?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const response = await this.request(`https://api.twilio.com/2010-04-01/${path}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: init.body
        ? new URLSearchParams(Object.entries(init.body).filter((entry): entry is [string, string] =>
            typeof entry[1] === "string"))
        : undefined,
    });
    const json = await response.json() as T & { message?: string; code?: number };
    if (!response.ok) {
      throw new Error(`twilio_management_failed:${json.code || response.status}`);
    }
    return json;
  }

  async findSubaccount(friendlyName: string) {
    const result = await this.call<{ accounts?: Array<{ sid: string; friendly_name: string; status?: string }> }>(
      `Accounts.json?${new URLSearchParams({ FriendlyName: friendlyName, PageSize: "20" })}`,
    );
    const account = result.accounts?.find((item) => item.friendly_name === friendlyName);
    return account && { sid: account.sid, friendlyName: account.friendly_name, status: account.status };
  }

  async createSubaccount(friendlyName: string) {
    const account = await this.call<{ sid: string; friendly_name: string; status?: string }>(
      "Accounts.json",
      { method: "POST", body: { FriendlyName: friendlyName } },
    );
    return { sid: account.sid, friendlyName: account.friendly_name, status: account.status };
  }

  async searchAvailableNumbers(input: {
    accountSid: string;
    countryCode: string;
    type: "local" | "tollFree";
    areaCode?: string;
    contains?: string;
    limit?: number;
  }) {
    const kind = input.type === "tollFree" ? "TollFree" : "Local";
    const query = new URLSearchParams({
      PageSize: String(Math.max(1, Math.min(input.limit || 10, 20))),
      ...(input.areaCode ? { AreaCode: input.areaCode } : {}),
      ...(input.contains ? { Contains: input.contains } : {}),
    });
    const result = await this.call<{
      available_phone_numbers?: Array<{
        phone_number: string;
        locality?: string;
        region?: string;
        capabilities?: Record<string, boolean>;
      }>;
    }>(`Accounts/${input.accountSid}/AvailablePhoneNumbers/${input.countryCode}/${kind}.json?${query}`);
    return (result.available_phone_numbers || []).map((number) => ({
      phoneNumber: number.phone_number,
      locality: number.locality,
      region: number.region,
      capabilities: number.capabilities,
    }));
  }

  async purchaseNumber(input: { accountSid: string; phoneNumber: string; friendlyName: string }) {
    const number = await this.call<{ sid: string; phone_number: string; account_sid: string }>(
      `Accounts/${input.accountSid}/IncomingPhoneNumbers.json`,
      {
        method: "POST",
        body: { PhoneNumber: input.phoneNumber, FriendlyName: input.friendlyName },
      },
    );
    return { sid: number.sid, phoneNumber: number.phone_number, accountSid: number.account_sid };
  }

  async configureNumber(input: {
    accountSid: string;
    numberSid: string;
    voiceUrl: string;
    statusCallbackUrl: string;
  }) {
    if (!input.numberSid) throw new Error("twilio_purchased_number_sid_missing");
    await this.call(
      `Accounts/${input.accountSid}/IncomingPhoneNumbers/${input.numberSid}.json`,
      {
        method: "POST",
        body: {
          VoiceMethod: "POST",
          VoiceUrl: input.voiceUrl,
          StatusCallback: input.statusCallbackUrl,
          StatusCallbackMethod: "POST",
        },
      },
    );
  }
}

export interface TwilioManagedProvisioningRequest {
  clientId: string;
  tenantSlug: string;
  operationKey: string;
  countryCode: string;
  numberType: "local" | "tollFree";
  areaCode?: string;
  contains?: string;
  selectedPhoneNumber?: string;
  friendlyName: string;
  voiceUrl: string;
  statusCallbackUrl: string;
  confirmedBy: string;
  confirmsPurchaseCost: boolean;
  confirmsRegulatoryRequirements: boolean;
  regulatoryBundleSid?: string;
  emergencyAddressSid?: string;
  monthlySpendCapPence: number;
  estimatedMonthlyCostPence: number;
}

export interface TwilioManagedProvisioningResult {
  subaccount: TwilioManagedSubaccount;
  availableNumbers: TwilioAvailableNumber[];
  purchasedNumber?: TwilioPurchasedNumber;
}

export class TwilioManagedNeedsAttentionError extends Error {
  constructor(
    public readonly result: TwilioManagedProvisioningResult,
    public readonly cause: unknown,
  ) {
    super("twilio_managed_number_needs_attention");
  }
}

function protectedIdsFromEnv(): Set<string> {
  return new Set([
    ...PROTECTED_TWILIO_RESOURCE_IDS,
    ...(process.env.TWILIO_PROTECTED_RESOURCE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean),
  ]);
}

export function assertTwilioResourceNotProtected(input: {
  clientId?: string;
  tenantSlug?: string;
  phoneNumber?: string;
  resourceIds?: Array<string | undefined>;
}) {
  if (
    (input.clientId && PROTECTED_TWILIO_TENANT_IDS.has(input.clientId)) ||
    (input.tenantSlug && PROTECTED_TWILIO_TENANT_IDS.has(input.tenantSlug)) ||
    input.phoneNumber === PROTECTED_TWILIO_NUMBER ||
    (input.resourceIds || []).some((id) => Boolean(id && protectedIdsFromEnv().has(id)))
  ) {
    throw new Error("protected_blades_twilio_resource");
  }
}

export function assertManagedTwilioPurchaseAllowed(input: TwilioManagedProvisioningRequest) {
  assertTwilioResourceNotProtected({
    ...input,
    phoneNumber: input.selectedPhoneNumber,
  });
  if (process.env.TWILIO_MANAGED_PROVISIONING_ENABLED !== "true") {
    throw new Error("twilio_managed_provisioning_disabled");
  }
  if (input.selectedPhoneNumber) {
    if (!input.confirmedBy.trim() || !input.confirmsPurchaseCost || !input.confirmsRegulatoryRequirements) {
      throw new Error("twilio_managed_purchase_confirmation_required");
    }
    if (
      !Number.isInteger(input.monthlySpendCapPence) ||
      input.monthlySpendCapPence <= 0 ||
      !Number.isInteger(input.estimatedMonthlyCostPence) ||
      input.estimatedMonthlyCostPence < 0 ||
      input.estimatedMonthlyCostPence > input.monthlySpendCapPence
    ) {
      throw new Error("twilio_managed_spend_cap_exceeded");
    }
  }
  if (
    !input.operationKey.trim() ||
    !/^[A-Z]{2}$/.test(input.countryCode) ||
    !input.voiceUrl.startsWith("https://") ||
    !input.statusCallbackUrl.startsWith("https://")
  ) {
    throw new Error("invalid_twilio_managed_provisioning_request");
  }
}

export async function provisionManagedTwilioNumber(
  input: TwilioManagedProvisioningRequest,
  adapter: TwilioManagementAdapter,
): Promise<TwilioManagedProvisioningResult> {
  assertManagedTwilioPurchaseAllowed(input);
  const subaccountName = `robinexis:${input.clientId}`;
  const subaccount =
    await adapter.findSubaccount(subaccountName) ||
    await adapter.createSubaccount(subaccountName);
  assertTwilioResourceNotProtected({
    ...input,
    resourceIds: [subaccount.sid],
  });
  const availableNumbers = await adapter.searchAvailableNumbers({
    accountSid: subaccount.sid,
    countryCode: input.countryCode,
    type: input.numberType,
    areaCode: input.areaCode,
    contains: input.contains,
    limit: 10,
  });
  if (!input.selectedPhoneNumber) return { subaccount, availableNumbers };
  assertTwilioResourceNotProtected({ ...input, phoneNumber: input.selectedPhoneNumber });
  const eligible = availableNumbers.find((number) => number.phoneNumber === input.selectedPhoneNumber);
  if (!eligible) throw new Error("selected_twilio_number_not_available");
  const purchasedNumber = await adapter.purchaseNumber({
    accountSid: subaccount.sid,
    phoneNumber: eligible.phoneNumber,
    friendlyName: input.friendlyName,
  });
  // Purchased numbers are deliberately never released by compensation. If this
  // callback update fails the caller must persist the number as needs_attention.
  try {
    await adapter.configureNumber({
      accountSid: subaccount.sid,
      numberSid: purchasedNumber.sid || "",
      voiceUrl: input.voiceUrl,
      statusCallbackUrl: input.statusCallbackUrl,
    });
  } catch (error) {
    throw new TwilioManagedNeedsAttentionError(
      { subaccount, availableNumbers, purchasedNumber },
      error,
    );
  }
  return { subaccount, availableNumbers, purchasedNumber };
}

function managementClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!accountSid || !authToken) throw new Error("twilio_not_configured");
  return twilio(accountSid, authToken);
}

export async function findOwnedTwilioNumber(
  e164: string,
  credentials?: { accountSid: string; apiKeySid: string; apiKeySecret: string },
): Promise<TwilioNumber | undefined> {
  if (!e164.match(/^\+[1-9]\d{7,14}$/)) throw new Error("valid_e164_phone_number_required");
  const client = credentials
    ? twilio(credentials.apiKeySid, credentials.apiKeySecret, { accountSid: credentials.accountSid })
    : managementClient();
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });
  const number = numbers[0];
  return number ? { phoneNumber: number.phoneNumber, sid: number.sid } : undefined;
}

export async function listOwnedTwilioNumbers(
  credentials: { accountSid: string; apiKeySid: string; apiKeySecret: string },
): Promise<TwilioNumber[]> {
  const client = twilio(credentials.apiKeySid, credentials.apiKeySecret, {
    accountSid: credentials.accountSid,
  });
  const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
  return numbers.map((number) => ({ phoneNumber: number.phoneNumber, sid: number.sid }));
}
