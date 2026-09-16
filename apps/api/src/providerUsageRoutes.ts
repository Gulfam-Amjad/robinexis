import {
  newId,
  type PlatformStore,
  type ProviderAccountSnapshot,
} from "@robinexis/database";
import {
  ElevenLabsManagementClient,
  type ElevenLabsSubscriptionSnapshot,
} from "@robinexis/integrations";
import type { ProviderUsagePortfolio } from "@robinexis/api-contracts";
import { canAdministerPlatform } from "./auth.js";
import type { ProductRouteContext } from "./productRoutes.js";

type SubscriptionReader = { getSubscription(): Promise<ElevenLabsSubscriptionSnapshot> };

export async function refreshElevenLabsAccountSnapshot(
  store: PlatformStore,
  reader: SubscriptionReader,
  now = new Date(),
): Promise<ProviderAccountSnapshot> {
  const capturedAt = now.toISOString();
  let snapshot: ProviderAccountSnapshot;
  try {
    const subscription = await reader.getSubscription();
    snapshot = {
      id: newId("provider_account_"),
      provider: "elevenlabs-convai",
      scope: "account",
      status: "healthy",
      usage: {
        characters: subscription.characterCount,
        nextResetAt: subscription.nextResetUnix
          ? new Date(subscription.nextResetUnix * 1_000).toISOString()
          : undefined,
      },
      limits: {
        tier: subscription.tier,
        status: subscription.status,
        characterLimit: subscription.characterLimit,
        canExtendCharacterLimit: subscription.canExtendCharacterLimit,
      },
      cost: {},
      capturedAt,
      createdAt: capturedAt,
    };
  } catch {
    snapshot = {
      id: newId("provider_account_"),
      provider: "elevenlabs-convai",
      scope: "account",
      status: "unavailable",
      usage: {},
      limits: {},
      cost: {},
      capturedAt,
      createdAt: capturedAt,
    };
  }
  await store.saveProviderAccountSnapshot(snapshot);
  return snapshot;
}

export async function providerUsagePortfolio(
  store: PlatformStore,
  from: string,
  to: string,
): Promise<ProviderUsagePortfolio> {
  const clients = await store.listClients();
  const rows = (await Promise.all(clients.map(async (client) => ({
    client,
    events: await store.listProviderUsageCostEvents(client.id, from, to),
  })))).flatMap(({ client, events }) => events.map((event) => ({ client, event })));
  const providers = ["elevenlabs-convai", "livekit-cascade"] as const;
  const providerTotals = providers.map((provider) => {
    const events = rows.filter((row) => row.event.provider === provider);
    return {
      provider,
      usageMinutes: events.reduce((sum, row) => sum + eventMinutes(row.event), 0),
      estimatedCostMinor: events.reduce((sum, row) => sum + row.event.costMinor, 0),
      eventCount: events.length,
      estimated: events.some((row) => row.event.metadata.estimated === true) ||
        (events.length > 0 && provider === "livekit-cascade"),
    };
  });
  const clientTotals = rows.reduce((map, row) => {
    const key = `${row.client.id}:${row.event.provider}`;
    const current = map.get(key) || {
      clientId: row.client.id,
      businessName: row.client.businessName,
      provider: row.event.provider,
      usageMinutes: 0,
      estimatedCostMinor: 0,
    };
    current.usageMinutes += eventMinutes(row.event);
    current.estimatedCostMinor += row.event.costMinor;
    map.set(key, current);
    return map;
  }, new Map<string, ProviderUsagePortfolio["clients"][number]>());
  const accountSnapshots = (await Promise.all(
    providers.map((provider) => store.getLatestProviderAccountSnapshot(provider)),
  )).filter((item): item is ProviderAccountSnapshot => Boolean(item)).map((item) => ({
    provider: item.provider,
    status: item.status,
    capturedAt: item.capturedAt,
    usage: item.usage,
    limits: item.limits,
  }));
  return {
    from,
    to,
    totals: {
      usageMinutes: providerTotals.reduce((sum, item) => sum + item.usageMinutes, 0),
      estimatedCostMinor: providerTotals.reduce((sum, item) => sum + item.estimatedCostMinor, 0),
      currency: "GBP",
    },
    providers: providerTotals,
    clients: [...clientTotals.values()].sort((a, b) => b.estimatedCostMinor - a.estimatedCostMinor),
    accountSnapshots,
  };
}

export async function handleProviderUsageRoute(ctx: ProductRouteContext, route: string): Promise<boolean> {
  if (route !== "/admin/provider-usage" && route !== "/admin/provider-usage/elevenlabs/refresh") return false;
  if (!canAdministerPlatform(ctx.actor)) {
    ctx.send(ctx.res, 403, { error: "platform_admin_required" });
    return true;
  }
  if (route === "/admin/provider-usage" && ctx.req.method === "GET") {
    const now = new Date();
    const from = validDate(ctx.url.searchParams.get("from")) ||
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const to = validDate(ctx.url.searchParams.get("to")) || now.toISOString();
    ctx.send(ctx.res, 200, await providerUsagePortfolio(ctx.store, from, to));
    return true;
  }
  if (route === "/admin/provider-usage/elevenlabs/refresh" && ctx.req.method === "POST") {
    if (!process.env.ELEVENLABS_API_KEY) {
      ctx.send(ctx.res, 503, { error: "elevenlabs_not_configured" });
      return true;
    }
    const snapshot = await refreshElevenLabsAccountSnapshot(
      ctx.store,
      new ElevenLabsManagementClient({ apiKey: process.env.ELEVENLABS_API_KEY }),
    );
    ctx.send(ctx.res, snapshot.status === "healthy" ? 200 : 503, {
      provider: snapshot.provider,
      status: snapshot.status,
      capturedAt: snapshot.capturedAt,
      usage: snapshot.usage,
      limits: snapshot.limits,
    });
    return true;
  }
  ctx.send(ctx.res, 405, { error: "method_not_allowed" });
  return true;
}

function eventMinutes(event: { usageUnit: string; usageQuantity: number }) {
  if (event.usageUnit === "seconds") return event.usageQuantity / 60;
  if (event.usageUnit === "minutes") return event.usageQuantity;
  return 0;
}

function validDate(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}
