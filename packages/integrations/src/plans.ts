export type PlanTier = "starter" | "pro" | "enterprise";

export type PlanFeature =
  | "automated-call-answering"
  | "cancellation-follow-up"
  | "rescheduling-dashboard"
  | "smart-rebooking"
  | "automatic-waitlist-filling"
  | "revenue-recovery-dashboard"
  | "multi-location-calendars"
  | "custom-workflows"
  | "advanced-reporting"
  | "dedicated-onboarding"
  | "premium-support";

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  monthlyPricePence: number | null;
  trialDays: number;
  calendarLimit: number | null;
  locationLimit: number | null;
  includedMinutes: number;
  phoneProvisioning: {
    customerOwned: boolean;
    managed: boolean;
    monthlySpendCapPence: number;
  };
  features: readonly PlanFeature[];
}

const DEFAULT_INCLUDED_MINUTES: Record<PlanTier, number> = {
  starter: 300,
  pro: 1_500,
  enterprise: 5_000,
};

function configuredMinutes(tier: PlanTier): number {
  const key = `PLAN_${tier.toUpperCase()}_INCLUDED_MINUTES`;
  const configured = Number(process.env[key]);
  return Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_INCLUDED_MINUTES[tier];
}

function configuredPhoneSpendCap(tier: PlanTier): number {
  const value = Number(process.env[`PLAN_${tier.toUpperCase()}_TWILIO_SPEND_CAP_PENCE`]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function planCatalog(): Record<PlanTier, PlanDefinition> {
  const starterFeatures = [
    "automated-call-answering",
    "cancellation-follow-up",
    "rescheduling-dashboard",
  ] as const;
  const proFeatures = [
    ...starterFeatures,
    "smart-rebooking",
    "automatic-waitlist-filling",
    "revenue-recovery-dashboard",
  ] as const;

  return {
    starter: {
      tier: "starter",
      name: "Starter",
      monthlyPricePence: 9_900,
      trialDays: 3,
      calendarLimit: 1,
      locationLimit: 1,
      includedMinutes: configuredMinutes("starter"),
      phoneProvisioning: {
        customerOwned: true,
        managed: false,
        monthlySpendCapPence: configuredPhoneSpendCap("starter"),
      },
      features: starterFeatures,
    },
    pro: {
      tier: "pro",
      name: "Pro",
      monthlyPricePence: 24_900,
      trialDays: 3,
      calendarLimit: 5,
      locationLimit: 1,
      includedMinutes: configuredMinutes("pro"),
      phoneProvisioning: {
        customerOwned: true,
        managed: false,
        monthlySpendCapPence: configuredPhoneSpendCap("pro"),
      },
      features: proFeatures,
    },
    enterprise: {
      tier: "enterprise",
      name: "Enterprise",
      monthlyPricePence: null,
      trialDays: 3,
      calendarLimit: null,
      locationLimit: null,
      includedMinutes: configuredMinutes("enterprise"),
      phoneProvisioning: {
        customerOwned: true,
        managed: false,
        monthlySpendCapPence: configuredPhoneSpendCap("enterprise"),
      },
      features: [
        ...proFeatures,
        "multi-location-calendars",
        "custom-workflows",
        "advanced-reporting",
        "dedicated-onboarding",
        "premium-support",
      ],
    },
  };
}

export function planDefinition(tier: PlanTier): PlanDefinition {
  return planCatalog()[tier];
}

export function planHasFeature(tier: PlanTier, feature: PlanFeature): boolean {
  return planDefinition(tier).features.includes(feature);
}

export function isPlanTier(value: unknown): value is PlanTier {
  return value === "starter" || value === "pro" || value === "enterprise";
}

/**
 * These features are promised by the public site but depend on an outbound
 * service which is currently retired. Keep entitlement separate from runtime
 * availability so the product never claims that an unavailable action ran.
 */
export function featureOperationallyAvailable(feature: PlanFeature): boolean {
  if (feature === "smart-rebooking" || feature === "automatic-waitlist-filling") {
    return process.env.OUTBOUND_AUTOMATION_ENABLED === "true";
  }
  return true;
}

export type DefaultVoicePipeline = "elevenlabs-convai" | "livekit-cascade";

/** Cheap cascade is only the Starter default when the LiveKit runtime is actually on. */
export function cheapVoiceDefaultEnabled(): boolean {
  return process.env.CHEAP_VOICE_DEFAULT_ENABLED === "true"
    && process.env.VOICE_RUNTIME_ENABLED === "true";
}

export function defaultVoicePipeline(tier: PlanTier): DefaultVoicePipeline {
  if (cheapVoiceDefaultEnabled() && tier === "starter") return "livekit-cascade";
  return "elevenlabs-convai";
}
