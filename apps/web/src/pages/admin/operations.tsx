import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../../lib/api";
import { useToast } from "../../state";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, MetricCard, PageHeader, SectionHeading, statusTone } from "../../components/ui";

export function AdminOperationsPage() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const control = useQuery({ queryKey: ["admin-control-plane"], queryFn: api.adminControlPlane, retry: false });
  const summary = useQuery({ queryKey: ["admin-summary"], queryFn: api.adminSummary, retry: false });
  const replayBilling = useMutation({
    mutationFn: (eventId: string) => api.replayBillingEvent(eventId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      push({ title: "Billing event replayed", message: `Stripe state: ${result.status || "processed"}.`, tone: "success" });
    },
    onError: (error) => push({ title: "Replay needs attention", message: error.message, tone: "error" }),
  });
  const updateRequest = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "in_progress" | "completed" | "rejected" }) =>
      api.updateAdminRequestStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-control-plane"] });
      push({ title: "Customer request updated", tone: "success" });
    },
    onError: (error) => push({ title: "Request update failed", message: error.message, tone: "error" }),
  });
  if (control.isLoading) return <LoadingState label="Loading platform operations…" />;
  if (control.error || !control.data) return <ErrorState error={control.error || new Error("Operations data unavailable")} onRetry={() => control.refetch()} />;
  const data = control.data;
  const blocked = data.provisioning.filter((item) => item.runStatus === "failed" || item.blockers.length);
  const unhealthy = data.resources.filter((item) => !item.healthy);
  const pendingRequests = data.requests.filter((item) => item.status === "pending");

  return <>
    <PageHeader eyebrow="Platform · Operations" title="Operations dashboard" description="Cross-customer health, queues, and action paths for Robinexis operators." actions={<Button variant="secondary" onClick={() => { void control.refetch(); void summary.refetch(); }}><RefreshCw size={15} /> Refresh</Button>} />
    <div className="metrics-grid metrics-compact">
      <MetricCard label="Platform health" value={data.health.status} detail={`Generated ${formatDate(data.generatedAt)}`} icon={Activity} tone={data.health.status === "ok" ? "sage" : "peach"} />
      <MetricCard label="Setup queue" value={summary.data?.setupQueueCount ?? data.provisioning.length} detail={`${blocked.length} blocked or failed`} icon={Clock3} tone="peach" />
      <MetricCard label="Resource issues" value={unhealthy.length} detail={`${data.resources.length} resources tracked`} icon={ShieldCheck} />
      <MetricCard label="Customer requests" value={pendingRequests.length} detail="Pending operator review" icon={Users} tone="lilac" />
    </div>
    {summary.error && <p className="inline-notice" role="status">Commercial summary is unavailable. Operational health below remains current.</p>}
    <div className="overview-grid">
      <Card className="panel">
        <SectionHeading title="Provisioning queue" description="Blocked and active setup work across customers." />
        {data.provisioning.length ? <div className="team-list">{data.provisioning.map((item) => <div className="team-row" key={item.clientId}>
          {item.blockers.length ? <AlertTriangle className="danger-icon" /> : <Clock3 />}
          <div><strong>{item.businessName}</strong><small>{item.step?.replaceAll("_", " ") || item.onboardingStatus?.replaceAll("_", " ") || "Waiting"}{item.blockers[0] ? ` · ${item.blockers[0]}` : ""}</small></div>
          <Badge tone={item.blockers.length ? "danger" : statusTone(item.runStatus)}>{item.runStatus || "waiting"}</Badge>
          <Link className="button button-secondary button-sm" to={`/admin/setup/${item.clientId}`}>Review</Link>
        </div>)}</div> : <EmptyState icon={CheckCircle2} title="Provisioning queue is clear" description="No staged or failed provisioning work was returned." />}
      </Card>
      <Card className="panel">
        <SectionHeading title="System safeguards" description="Current queue, spend-cap, and backup configuration state." />
        <dl className="detail-list">
          <div><dt>Notification queue</dt><dd>{data.health.notificationQueue.pending} pending · {data.health.notificationQueue.deadLetter} dead-letter</dd></div>
          <div><dt>Provider failures (24h)</dt><dd>{data.health.notificationQueue.providerFailures24h}</dd></div>
          <div><dt>Spend caps</dt><dd>{data.health.spend.configuredCapCount} configured · {data.health.spend.uncappedConnectionCount} uncapped</dd></div>
          <div><dt>Backup</dt><dd className="capitalize">{data.health.backup.status.replaceAll("_", " ")} · freshness {data.health.backup.freshness}</dd></div>
        </dl>
        <Link className="button button-secondary button-sm" to="/admin/control-plane">Open detailed control plane</Link>
      </Card>
    </div>
    <Card className="panel">
      <SectionHeading title="Customer request queue" description="Support and lifecycle requests waiting across tenant boundaries." />
      {data.requests.length ? <div className="team-list">{data.requests.map((item) => <div className="team-row" key={item.id}><Users /><div><strong>{item.businessName}</strong><small>{item.type.replaceAll("_", " ")} · {formatDate(item.createdAt)}</small></div><Badge tone={statusTone(item.status)}>{item.status}</Badge>{!["completed", "rejected", "revoked"].includes(item.status) && <div className="row-actions"><Button size="sm" variant="secondary" disabled={updateRequest.isPending} onClick={() => updateRequest.mutate({ id: item.id, status: "in_progress" })}>Start</Button><Button size="sm" disabled={updateRequest.isPending} onClick={() => updateRequest.mutate({ id: item.id, status: "completed" })}>Complete</Button><Button size="sm" variant="ghost" disabled={updateRequest.isPending} onClick={() => window.confirm("Reject this customer request? The action is audited.") && updateRequest.mutate({ id: item.id, status: "rejected" })}>Reject</Button></div>}</div>)}</div> : <EmptyState icon={Users} title="No customer requests" description="New tenant-scoped requests will appear here." />}
    </Card>
    <Card className="panel">
      <SectionHeading title="Billing recovery" description="Failed Stripe events remain visible and require an explicit audited replay." />
      {summary.isLoading ? <LoadingState label="Loading billing recovery…" /> : summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : summary.data?.failedBillingEvents?.length ? <div className="team-list">{summary.data.failedBillingEvents.map((event) => <div className="team-row" key={event.id}><CreditCard /><div><strong>{event.eventType}</strong><small>{event.error || "Processing failed"} · {formatDate(event.receivedAt)}</small></div><Button size="sm" variant="secondary" disabled={replayBilling.isPending} onClick={() => window.confirm(`Replay Stripe event ${event.id}?`) && replayBilling.mutate(event.id)}><RefreshCw size={14} /> Replay</Button></div>)}</div> : <EmptyState icon={CheckCircle2} title="No failed billing events" description="Stripe processing has no unresolved events." />}
    </Card>
  </>;
}
