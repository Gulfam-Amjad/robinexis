import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Clock3, RefreshCw, Search, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { filterClients } from "../../lib/admin";
import { useClient } from "../../state";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, MetricCard, PageHeader, SectionHeading } from "../../components/ui";

export function AdminUsageCostPage() {
  const { clients, isLoading, error } = useClient();
  const [search, setSearch] = useState("");
  const summary = useQuery({ queryKey: ["admin-summary"], queryFn: api.adminSummary, retry: false });
  const providerUsage = useQuery({ queryKey: ["provider-usage"], queryFn: () => api.providerUsage(), retry: false });
  const queryClient = useQueryClient();
  const refreshAccount = useMutation({
    mutationFn: api.refreshElevenLabsAccount,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["provider-usage"] }),
  });
  const filtered = useMemo(() => filterClients(clients, search), [clients, search]);

  if (isLoading || summary.isLoading || providerUsage.isLoading) return <LoadingState label="Loading usage and cost data…" />;
  if (error || summary.error) return <ErrorState error={error || summary.error} onRetry={() => summary.refetch()} />;
  const data = summary.data!;
  const providerData = providerUsage.data;
  const elevenLabsAccount = providerData?.accountSnapshots.find((item) => item.provider === "elevenlabs-convai");

  return <>
    <PageHeader eyebrow="Platform · Finance" title="Usage and cost" description="Customer minute allowance is reported separately from shared provider spend." />
    <div className="metrics-grid metrics-compact">
      <MetricCard label="Customer usage" value={Math.round(data.totalUsedMinutes)} detail={`Across all workspaces · ${data.month}`} icon={Clock3} />
      <MetricCard label="Catalog MRR estimate" value={`£${(data.mrrPence / 100).toFixed(0)}`} detail="Active Stripe plans before discounts and tax" icon={CircleDollarSign} tone="lilac" />
      <MetricCard
        label="Estimated provider spend"
        value={providerData ? `£${(providerData.totals.estimatedCostMinor / 100).toFixed(2)}` : "Unavailable"}
        detail="Configured per-call estimates; not customer allowance"
        icon={WalletCards}
        tone="peach"
      />
    </div>
    <div className="overview-grid">
      <Card className="panel">
        <SectionHeading title="Customer allowance" description="Commercial minute ledger and measured usage. These figures are not provider costs." />
        <label className="admin-search">
          <span className="sr-only">Search customer usage</span><Search size={17} aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" />
        </label>
        {!filtered.length ? <EmptyState icon={Search} title="No matching usage records" description="Try a different customer search." /> : (
          <div className="table-scroll">
            <table className="mobile-card-table">
              <thead><tr><th>Customer</th><th>Plan</th><th>Used</th><th>Remaining allowance</th><th>Provider cost</th><th>Failed calls this month</th></tr></thead>
              <tbody>{filtered.map((client) => {
                const usage = data.clients.find((item) => item.clientId === client.id);
                const provider = providerData?.clients?.find((item) => item.clientId === client.id);
                return <tr key={client.id}>
                  <td data-label="Customer"><Link to={`/admin/customers/${client.id}`}><strong>{client.businessName}</strong><small className="block">{client.slug}</small></Link></td>
                  <td data-label="Plan" className="capitalize">{usage?.plan || "Unavailable"}</td>
                  <td data-label="Used">{usage ? `${Math.round(usage.usedMinutes)} min` : "Unavailable"}</td>
                  <td data-label="Remaining allowance">{usage ? `${Math.round(usage.remainingMinutes)} min` : "Unavailable"}</td>
                  <td data-label="Provider cost">{provider ? `£${(provider.estimatedCostMinor / 100).toFixed(2)} · ${provider.provider}` : "Unavailable"}</td>
                  <td data-label="Failed calls this month">{usage?.failedCalls ?? "Unavailable"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="panel">
        <SectionHeading title="Shared provider usage" description="Account verification and per-call cost estimates. Customer allowance remains separate." />
        {providerUsage.error ? <ErrorState error={providerUsage.error} onRetry={() => providerUsage.refetch()} /> : <>
          <div className="row-actions">
            <Button variant="secondary" disabled={refreshAccount.isPending} onClick={() => refreshAccount.mutate()}>
              <RefreshCw size={15} /> Refresh ElevenLabs account
            </Button>
          </div>
          <div className="inline-notice">
            <Badge tone={elevenLabsAccount?.status === "healthy" ? "success" : "neutral"}>
              {elevenLabsAccount?.status || "Unavailable"}
            </Badge>
            <h3>ElevenLabs account snapshot</h3>
            <p>{elevenLabsAccount
              ? `Verified ${new Date(elevenLabsAccount.capturedAt).toLocaleString("en-GB")}. Tier: ${String(elevenLabsAccount.limits.tier || "not reported")}; characters: ${String(elevenLabsAccount.usage.characters ?? "not reported")} / ${String(elevenLabsAccount.limits.characterLimit ?? "not reported")}.`
              : "No verified account snapshot has been captured."}</p>
            {refreshAccount.error && <p role="alert">Account endpoint unavailable. No account values were inferred.</p>}
          </div>
        </>}
        <dl className="detail-list">
          {(providerData?.providers || []).map((provider) => <div key={provider.provider}>
            <dt>{provider.provider}</dt>
            <dd>{provider.usageMinutes.toFixed(1)} min · £{(provider.estimatedCostMinor / 100).toFixed(2)} {provider.estimated ? "estimated" : "recorded"}</dd>
          </div>)}
          <div><dt>Telephony cost</dt><dd>Unavailable</dd></div>
          <div><dt>Model cost</dt><dd>Unavailable</dd></div>
        </dl>
      </Card>
    </div>
  </>;
}
