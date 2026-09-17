import {
  DEMO_CLIENT_ID,
  isAiServiceEnabled,
  type ClientConfig,
} from "@robinexis/database";
import { checkAvailability, maskCalcomUsername, type CalcomTenant } from "./calcom.js";

export type PublicCalcomProbe = {
  ok: boolean;
  configured: boolean;
  usernameMasked: string;
  eventTypeSlug: string;
  slotCount: number;
  nextSlots: string[];
  probedAt: string;
  error?: string;
};

/** Maps slot results into a public payload. Never accepts or returns apiKey. */
export function publicCalcomProbe(input: {
  configured: boolean;
  username: string;
  eventTypeSlug: string;
  slots?: string[];
  error?: string;
  probedAt?: string;
}): PublicCalcomProbe {
  const slots = [...(input.slots ?? [])].sort();
  const payload: PublicCalcomProbe = {
    ok: Boolean(input.configured && !input.error),
    configured: input.configured,
    usernameMasked: maskCalcomUsername(input.username),
    eventTypeSlug: input.eventTypeSlug,
    slotCount: slots.length,
    nextSlots: slots.slice(0, 8),
    probedAt: input.probedAt ?? new Date().toISOString(),
  };
  if (!input.configured) {
    payload.ok = false;
    payload.error = input.error || "calcom_not_configured";
  } else if (input.error) {
    payload.ok = false;
    payload.error = input.error.slice(0, 200);
  }
  return payload;
}

export function calcomTenantFromClient(
  client: ClientConfig | undefined,
  resolveSecret: (reference: string) => string | undefined = (ref) => process.env[ref],
): CalcomTenant {
  const apiKey = client?.calendar.credentialRef
    ? resolveSecret(client.calendar.credentialRef) ?? ""
    : "";
  return {
    apiKey,
    username: client?.calendar.username || "",
  };
}

/**
 * Probes the event type the voice tools actually book against, so the dashboard
 * cannot report a healthy calendar while every call fails. Pass the mapping from
 * calendar_event_types; the raw service slug is only a legacy fallback.
 */
export async function probeCalcomForClient(opts: {
  client: ClientConfig | undefined;
  eventTypeSlug?: string;
  eventTypeId?: string;
  tenant?: CalcomTenant;
}): Promise<PublicCalcomProbe> {
  const slug =
    opts.eventTypeSlug ||
    opts.client?.services[0]?.slug ||
    "15min";
  const tenant = opts.tenant || calcomTenantFromClient(opts.client);
  const configured = Boolean(tenant.apiKey && (tenant.username || opts.eventTypeId));
  if (!configured) {
    return publicCalcomProbe({ configured: false, username: tenant.username, eventTypeSlug: slug });
  }
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  try {
    const { slots } = await checkAvailability(tenant, {
      eventTypeSlug: slug,
      eventTypeId: opts.eventTypeId,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    return publicCalcomProbe({
      configured: true,
      username: tenant.username,
      eventTypeSlug: slug,
      slots,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return publicCalcomProbe({
      configured: true,
      username: tenant.username,
      eventTypeSlug: slug,
      error: message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 200),
    });
  }
}

export function publicClientView(client: ClientConfig) {
  const access = isAiServiceEnabled(client);
  return {
    id: client.id,
    slug: client.slug,
    businessName: client.businessName,
    role: client.role,
    location: client.location,
    phone: client.phone,
    email: client.email,
    elevenlabsAgentId: client.elevenlabsAgentId,
    voicePipeline: client.voicePipeline,
    services: client.services,
    staff: client.staff,
    published: client.published,
    serviceStatus: client.serviceStatus,
    enabledFeatures: client.enabledFeatures,
    inboundNumbers: client.inboundNumbers,
    publishedFacts: client.publishedFacts,
    onboardingStatus: client.onboardingStatus,
    onboardingNotes: client.onboardingNotes,
    onboardingEta: client.onboardingEta,
    phoneAcquisitionMode: client.phoneAcquisitionMode,
    requestedPhoneNumber: client.requestedPhoneNumber,
    access,
    calendar: {
      provider: client.calendar.provider,
      username: client.calendar.username,
    },
    calendarNotes: client.calendarNotes
      ? { provider: client.calendarNotes.provider, calendarId: client.calendarNotes.calendarId }
      : undefined,
    demoTenant: client.id === DEMO_CLIENT_ID || client.slug === DEMO_CLIENT_ID,
  };
}
