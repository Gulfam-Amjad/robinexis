import { createHash } from "node:crypto";
import {
  type ClientConfig,
  type PlatformStore,
  type UserProfile,
} from "@robinexis/database";
import { calcomSharedAccountEnabled, defaultVoicePipeline, planDefinition, type PlanTier } from "@robinexis/integrations";
import type { AuthenticatedActor } from "./auth.js";

export function writableClientId(actor: AuthenticatedActor): string | undefined {
  return Object.entries(actor.clientRoles).find(([, role]) =>
    role === "owner" || role === "manager" || role === "operator",
  )?.[0];
}

export async function ensureSelfServeWorkspace(
  store: PlatformStore,
  actor: Pick<AuthenticatedActor, "subject" | "email">,
  plan: PlanTier,
): Promise<ClientConfig> {
  const existingProfile = await store.getUserProfileByAuthUserId(actor.subject);
  if (existingProfile?.clientId) {
    const existing = await store.getClient(existingProfile.clientId);
    if (existing) return existing;
  }
  const memberships = await store.listMembershipsForEmail(actor.email);
  if (memberships[0]) {
    const existing = await store.getClient(memberships[0].clientId);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  const client = await uniqueSkeletonClient(actor.email, plan);
  client.calendar = {
    provider: "calcom",
  };
  await store.upsertClient(client);
  await store.upsertLocation({
    id: `loc_${client.id}_primary`,
    clientId: client.id,
    slug: "primary",
    name: client.businessName,
    timezone: client.callingWindow.tz,
    address: {},
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  });
  // Without Cal.com Platform there is no per-tenant credential to issue, so a
  // shared-account connection is opened up front and isolation is carried by the
  // tenant-prefixed event types provisioning creates.
  const shared = calcomSharedAccountEnabled();
  await store.upsertCalendarConnection({
    id: `calendar_${client.id}_primary`,
    clientId: client.id,
    locationId: `loc_${client.id}_primary`,
    provider: "calcom",
    credentialRef: shared ? "CALCOM_API_KEY" : "CONNECTION_REQUIRED",
    mode: shared ? "shared" : undefined,
    status: shared ? "active" : "pending",
    metadata: shared
      ? { isolation: "tenant_scoped_event_types" }
      : { isolation: "connection_required" },
    createdAt: now,
    updatedAt: now,
  });
  await store.upsertMembership({
    id: `mem_${client.id}_owner`,
    clientId: client.id,
    email: actor.email,
    role: "owner",
    createdAt: now,
  });
  const profile: UserProfile = {
    id: `user_${actor.subject}`,
    clientId: client.id,
    authUserId: actor.subject,
    email: actor.email,
    platformRole: "client",
    workspaceRole: "owner",
    createdAt: existingProfile?.createdAt || now,
    updatedAt: now,
  };
  await store.upsertUserProfile(profile);
  return client;
}

async function uniqueSkeletonClient(
  email: string,
  plan: PlanTier,
): Promise<ClientConfig> {
  const definition = planDefinition(plan);
  const normalizedEmail = email.trim().toLowerCase();
  const identityHash = createHash("sha256").update(normalizedEmail).digest("hex");
  const local = normalizedEmail.split("@")[0] || "workspace";
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";
  const slug = `${base}-${identityHash.slice(0, 8)}`;
  const id = `client_self_${identityHash.slice(0, 24)}`;
  return {
    id,
    slug,
    businessName: `${local} workspace`,
    role: "voice receptionist",
    greeting: "Hi, thanks for calling — how can I help today?",
    tone: "warm, brief and natural; ask one useful question at a time",
    location: "",
    phone: "",
    email,
    transferNumber: "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "",
    voicePipeline: defaultVoicePipeline(plan),
    services: [],
    staff: [],
    policies: [],
    publishedFacts: [],
    unknownTopics: [],
    calendar: {
      provider: "calcom",
    },
    calendarNoteMode: "summary",
    enabledFeatures: [...definition.features],
    inboundNumbers: [],
    callingWindow: { tz: "Europe/London", startHour: 8, endHour: 21, skipSunday: true },
    maxConcurrentCalls: 2,
    outboundRatePerHour: 10,
    firstCampaignRequiresApproval: true,
    published: false,
    serviceStatus: "incomplete",
    subscribedProduct: plan,
    monthlyMinuteLimit: definition.includedMinutes,
    onboardingStatus: "payment_required",
  };
}
