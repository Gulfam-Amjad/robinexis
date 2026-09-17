import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  Gauge,
  LockKeyhole,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Client, ClientSummary } from "@robinexis/api-contracts";
import { api, initials } from "../../lib/api";
import { filterClients } from "../../lib/admin";
import { useClient } from "../../state";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  SectionHeading,
} from "../../components/ui";

const PROTECTED_CLIENT_ID = "client_blades_hair";

export default function AdminVoiceRoutingPage() {
  const { clients, isLoading, error } = useClient();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => filterClients(clients, search), [clients, search]);
  const usage = useQuery({
    queryKey: ["provider-usage"],
    queryFn: () => api.providerUsage(),
    retry: false,
  });
  const details = useQueries({
    queries: clients.map((client) => ({
      queryKey: ["client", client.id],
      queryFn: () => api.client(client.id),
      retry: false,
    })),
  });
  if (isLoading) return <LoadingState label="Loading voice routing…" />;
  if (error) return <ErrorState error={error} />;

  const detailedClients = details.flatMap((query) => query.data ? [query.data] : []);
  const costSaver = detailedClients.filter((client) => client.voicePipeline === "livekit-cascade").length;
  const premium = detailedClients.filter((client) => client.voicePipeline === "elevenlabs-convai").length;
  const configured = detailedClients.filter((client) => Boolean(client.voicePipeline)).length;
  const totalCost = usage.data?.clientTotals?.reduce(
    (sum, client) => sum + client.estimatedCostMinor,
    0,
  );

  return <>
    <PageHeader
      eyebrow="Platform · Voice infrastructure"
      title="Voice routing"
      description="One operator-only control center for provider mode, readiness, cost and rollback."
    />
    <div className="metrics-grid">
      <MetricCard label="ElevenLabs Premium" value={details.some((query) => query.isLoading) ? "…" : premium} detail="ConvAI end-to-end" icon={Sparkles} tone="cream" />
      <MetricCard label="Cost Saver" value={details.some((query) => query.isLoading) ? "…" : costSaver} detail="Deepgram + Groq + ElevenLabs TTS" icon={Gauge} tone="sage" />
      <MetricCard label="Configured tenants" value={details.some((query) => query.isLoading) ? "…" : `${configured}/${clients.length}`} detail="Voice pipeline assigned" icon={Network} tone="lilac" />
      <MetricCard label="Estimated provider cost" value={totalCost === undefined ? "—" : `£${(totalCost / 100).toFixed(2)}`} detail="Current reporting window" icon={ShieldCheck} tone="peach" />
    </div>

    <div className="provider-comparison-grid">
      <Card className="provider-mode-card provider-mode-premium">
        <div className="provider-mode-heading"><span><Sparkles /></span><div><small>Premium mode</small><h2>ElevenLabs Premium</h2></div><Badge tone="accent">Best experience</Badge></div>
        <p>ElevenLabs handles listening, reasoning, turn-taking and speech for flagship quality.</p>
        <ul><li>Best interruption handling</li><li>Premium demo experience</li><li>Safest default and rollback target</li></ul>
      </Card>
      <Card className="provider-mode-card provider-mode-saver">
        <div className="provider-mode-heading"><span><Gauge /></span><div><small>Cost-efficient mode</small><h2>Cost Saver</h2></div><Badge tone="success">Lower cost</Badge></div>
        <p>Deepgram listens, Groq reasons, and the same ElevenLabs voice speaks through LiveKit.</p>
        <ul><li>ElevenLabs voice retained</li><li>Component cost visibility</li><li>Quality gate required before routing</li></ul>
      </Card>
    </div>

    <Card className="panel">
      <SectionHeading title="Customer routing portfolio" description="Open a customer to prepare, gate, switch, observe or roll back its provider." />
      <div className="admin-toolbar">
        <label className="admin-search">
          <span className="sr-only">Search voice routing customers</span>
          <Search size={17} aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, mode or status" />
        </label>
        <span className="muted" role="status">{filtered.length} of {clients.length} customers</span>
      </div>
      {!filtered.length
        ? <EmptyState icon={Search} title="No matching customers" description="Try a customer name, slug, identifier or service status." />
        : <div className="routing-customer-list">{filtered.map((client) =>
          <RoutingCustomerRow
            client={client}
            detail={details[clients.findIndex((item) => item.id === client.id)]?.data}
            cost={usage.data?.clientTotals?.find((item) => item.clientId === client.id)}
            key={client.id}
          />)}
        </div>}
      {usage.error && <p className="inline-notice" role="status">Cost telemetry is unavailable. Provider assignment and health remain visible.</p>}
    </Card>
  </>;
}

function RoutingCustomerRow({
  client,
  detail,
  cost,
}: {
  client: ClientSummary;
  detail?: Client;
  cost?: { estimatedCostMinor: number; usageMinutes: number; providers: string[] };
}) {
  const health = useQuery({
    queryKey: ["provider-health", client.id],
    queryFn: () => api.providerHealth(client.id),
    retry: false,
  });
  const saver = detail?.voicePipeline === "livekit-cascade";
  const protectedTenant = client.id === PROTECTED_CLIENT_ID;
  return <article className="routing-customer-row">
    <div className="routing-customer-identity">
      <span className="client-avatar">{initials(client.businessName)}</span>
      <div><strong>{client.businessName}</strong><small>{client.slug}</small></div>
    </div>
    <div><small>Active mode</small><strong>{detail ? saver ? "Cost Saver" : "ElevenLabs Premium" : "Loading…"}</strong>{detail && <Badge tone={saver ? "success" : "accent"}>{saver ? "Lower cost" : "Premium"}</Badge>}</div>
    <div><small>Provider health</small>{health.isLoading ? <span className="muted">Checking…</span> : <Badge tone={health.data?.status === "healthy" ? "success" : "warning"}>{health.data?.status || "Needs review"}</Badge>}</div>
    <div><small>Estimated cost</small><strong>{cost ? `£${(cost.estimatedCostMinor / 100).toFixed(2)}` : "—"}</strong><span>{cost ? `${cost.usageMinutes.toFixed(1)} min` : "No usage reported"}</span></div>
    <div className="routing-customer-action">
      {protectedTenant && <span className="protected-label"><LockKeyhole size={13} /> Protected tenant</span>}
      {!protectedTenant && client.published && <span className="ready-label"><CheckCircle2 size={13} /> Eligible for preflight</span>}
      <Link className="button button-secondary button-sm" to={`/admin/customers/${client.id}#voice-routing`}>Manage routing <ChevronRight size={15} /></Link>
    </div>
  </article>;
}
