import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Plus, RefreshCw, Search, ShieldAlert, Store, Users } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, formatDate, initials } from "../../lib/api";
import { filterClients } from "../../lib/admin";
import { useClient, useToast } from "../../state";
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, LoadingState, PageHeader, SectionHeading, statusTone } from "../../components/ui";
import { CreditAdjustmentDialog } from "./credit-adjustment-dialog";
import { ServiceActionDialog } from "./service-action-dialog";
import type { ProviderBenchmarkMetrics } from "@robinexis/api-contracts";

export function AdminCustomersPage() {
  const { clients, isLoading, error, setActiveClientId } = useClient();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => filterClients(clients, search), [clients, search]);
  const summary = useQuery({ queryKey: ["admin-summary"], queryFn: api.adminSummary, retry: false });
  const navigate = useNavigate();

  if (isLoading) return <LoadingState label="Loading customer portfolio…" />;
  if (error) return <ErrorState error={error} />;
  const openWorkspace = (clientId: string) => {
    setActiveClientId(clientId);
    navigate("/app");
  };

  return <>
    <PageHeader eyebrow="Platform · Customers" title="Customer portfolio" description="Search and review every tenant from the operator platform. Workspace users cannot access these controls." actions={<LinkButton to="/admin/clients/new"><Plus size={15} /> Add customer</LinkButton>} />
    <Card className="panel">
      <div className="admin-toolbar">
        <label className="admin-search">
          <span className="sr-only">Search customers</span>
          <Search size={17} aria-hidden="true" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, slug, ID, or status" />
        </label>
        <span className="muted" role="status">{filtered.length} of {clients.length} customers</span>
      </div>
      {!clients.length ? (
        <EmptyState icon={Users} title="No customer workspaces" description="Create the first tenant without exposing platform controls to workspace users." action={<LinkButton to="/admin/clients/new">Add first customer</LinkButton>} />
      ) : !filtered.length ? (
        <EmptyState icon={Search} title="No matching customers" description="Try another name, slug, identifier, or status." action={<Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button>} />
      ) : (
        <div className="admin-client-grid">
          {filtered.map((client) => {
            const health = summary.data?.clients.find((item) => item.clientId === client.id);
            return <article className="admin-client-card" key={client.id}>
              <div className="admin-client-heading">
                <span className="client-avatar">{initials(client.businessName)}</span>
                <div><strong>{client.businessName}</strong><small>{client.slug}</small></div>
                <Badge tone={client.access?.inbound ? "success" : client.published ? "warning" : "neutral"}>{client.access?.inbound ? "Inbound active" : client.published ? "Published" : "Draft"}</Badge>
              </div>
              <dl className="detail-list">
                <div><dt>Service</dt><dd className="capitalize">{client.serviceStatus.replaceAll("_", " ")}</dd></div>
                <div><dt>Setup</dt><dd className="capitalize">{client.onboardingStatus?.replaceAll("_", " ") || "Not reported"}</dd></div>
                <div><dt>Plan</dt><dd className="capitalize">{health?.plan || "Unavailable"}</dd></div>
                <div><dt>Subscription</dt><dd className="capitalize">{health?.subscriptionStatus?.replaceAll("_", " ") || "Unavailable"}</dd></div>
                <div><dt>Customer allowance</dt><dd>{health ? `${Math.round(health.remainingMinutes)} min remaining` : "Unavailable"}</dd></div>
                <div><dt>Failed calls this month</dt><dd>{health?.failedCalls ?? "Unavailable"}</dd></div>
              </dl>
              <div className="row-actions">
                <Link className="button button-secondary button-sm" to={`/admin/customers/${client.id}`}>Customer detail <ChevronRight size={15} /></Link>
                <Button variant="ghost" onClick={() => openWorkspace(client.id)}>Open workspace</Button>
              </div>
            </article>;
          })}
        </div>
      )}
      {summary.error && <p className="inline-notice" role="status">Usage and plan details are unavailable. Customer identity and workspace status remain current.</p>}
    </Card>
  </>;
}

export function AdminCustomerDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setActiveClientId } = useClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [switchTarget, setSwitchTarget] = useState<"elevenlabs-convai" | "livekit-cascade">("livekit-cascade");
  const [switchConfirmation, setSwitchConfirmation] = useState("");
  const [switchOperationId, setSwitchOperationId] = useState<string>();
  const [preparedTarget, setPreparedTarget] = useState<string>();
  const [preparedDeploymentId, setPreparedDeploymentId] = useState<string>();
  const [baselineBenchmark, setBaselineBenchmark] = useState("");
  const [candidateBenchmark, setCandidateBenchmark] = useState("");
  const [serviceDialog, setServiceDialog] = useState<"suspend" | "reactivate">();
  const customer = useQuery({ queryKey: ["client", id], queryFn: () => api.client(id!), enabled: Boolean(id), retry: false });
  const summary = useQuery({ queryKey: ["admin-summary"], queryFn: api.adminSummary, retry: false });
  const control = useQuery({ queryKey: ["admin-control-plane"], queryFn: api.adminControlPlane, retry: false });
  const providerHealth = useQuery({
    queryKey: ["provider-health", id],
    queryFn: () => api.providerHealth(id!),
    enabled: Boolean(id),
    retry: false,
  });
  const providerUsage = useQuery({
    queryKey: ["provider-usage"],
    queryFn: () => api.providerUsage(),
    retry: false,
  });
  const audit = useQuery({
    queryKey: ["admin-audit", id],
    queryFn: () => api.adminAudit(id),
    enabled: Boolean(id),
    retry: false,
  });
  const launchGate = useQuery({
    queryKey: ["provider-launch-gate", id, preparedDeploymentId],
    queryFn: () => api.providerLaunchGate(id!, preparedDeploymentId!),
    enabled: Boolean(id && preparedDeploymentId && switchTarget === "livekit-cascade"),
    retry: false,
  });
  const switchStatus = useQuery({
    queryKey: ["provider-switch-status", id, switchOperationId],
    queryFn: () => api.providerSwitchStatus(id!, switchOperationId),
    enabled: Boolean(id && switchOperationId),
    retry: false,
    refetchInterval: (query) => ["in_progress", "rollback_in_progress"].includes(query.state.data?.status || "") ? 1_500 : false,
  });
  const switchPreview = useMutation({
    mutationFn: () => api.previewProviderSwitch(id!, switchTarget),
    onError: (mutationError) => push({ title: "Preflight blocked", message: mutationError.message, tone: "error" }),
  });
  const prepareProvider = useMutation({
    mutationFn: () => api.prepareProviderDeployment(id!, switchTarget),
    onSuccess: (deployment) => {
      setPreparedTarget(deployment.provider);
      setPreparedDeploymentId(deployment.deploymentId);
      switchPreview.reset();
      push({ title: "Staged deployment prepared", message: "No live routing was changed.", tone: "success" });
    },
    onError: (mutationError) => push({ title: "Preparation failed", message: mutationError.message, tone: "error" }),
  });
  const evaluateGate = useMutation({
    mutationFn: () => api.evaluateProviderLaunchGate(id!, {
      deploymentId: preparedDeploymentId!,
      candidateProvider: switchTarget,
      source: "manual",
      baseline: parseBenchmark(baselineBenchmark),
      candidate: parseBenchmark(candidateBenchmark),
    }),
    onSuccess: async () => {
      await launchGate.refetch();
      switchPreview.reset();
      push({ title: "Quality gate evaluated", message: "Benchmark evidence was stored without changing live routing.", tone: "success" });
    },
    onError: (mutationError) => push({ title: "Quality gate failed", message: mutationError.message, tone: "error" }),
  });
  const providerSwitch = useMutation({
    mutationFn: () => api.startProviderSwitch(id!, {
      toProvider: switchTarget,
      idempotencyKey: crypto.randomUUID(),
      confirmation: switchConfirmation,
    }),
    onSuccess: (operation) => {
      setSwitchOperationId(operation.id);
      push({ title: operation.status === "live" ? "Provider is live" : "Provider switch started", tone: "success" });
    },
    onError: (mutationError) => push({ title: "Provider switch failed", message: mutationError.message, tone: "error" }),
  });
  const rollbackSwitch = useMutation({
    mutationFn: (operationId: string) => api.rollbackProviderSwitch(id!, operationId, switchConfirmation),
    onSuccess: (operation) => {
      setSwitchOperationId(operation.id);
      push({ title: "Rollback requested", tone: "success" });
    },
    onError: (mutationError) => push({ title: "Rollback failed", message: mutationError.message, tone: "error" }),
  });
  const adjustment = useMutation({
    mutationFn: ({ minutes, reason }: { minutes: number; reason: string }) => api.adjustCredits(id!, minutes, reason, crypto.randomUUID()),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      setSearchParams({}, { replace: true });
      push({ title: "Customer allowance updated", message: `${result.remainingMinutes} minutes remain.`, tone: "success" });
    },
    onError: (mutationError) => push({ title: "Adjustment failed", message: mutationError.message, tone: "error" }),
  });
  const serviceAction = useMutation({
    mutationFn: ({ action, reason }: { action: "suspend" | "reactivate"; reason: string }) =>
      api.setServiceStatus(id!, action, reason),
    onSuccess: async () => {
      await Promise.all([customer.refetch(), queryClient.invalidateQueries({ queryKey: ["clients"] })]);
      setServiceDialog(undefined);
      push({ title: "Service status updated", tone: "success" });
    },
    onError: (mutationError) => push({ title: "Status update failed", message: mutationError.message, tone: "error" }),
  });

  if (customer.isLoading) return <LoadingState label="Loading customer detail…" />;
  if (customer.error || !customer.data) return <ErrorState error={customer.error || new Error("Customer not found")} onRetry={() => customer.refetch()} />;
  const client = customer.data;
  const usage = summary.data?.clients.find((item) => item.clientId === id);
  const providerCost = providerUsage.data?.clientTotals?.find((item) => item.clientId === id);
  const resources = control.data?.resources.filter((item) => item.clientId === id) || [];
  const openWorkspace = () => {
    setActiveClientId(client.id);
    navigate("/app");
  };

  return <>
    <Link className="back-link" to="/admin/customers"><ArrowLeft size={15} /> Customer portfolio</Link>
    <PageHeader eyebrow="Platform · Customer detail" title={client.businessName} description={`${client.slug} · ${client.id}`} actions={<><Button variant="secondary" onClick={openWorkspace}>Open workspace</Button><Button onClick={() => setSearchParams({ adjust: "credits" })}>Adjust allowance</Button></>} />
    <div className="overview-grid">
      <Card className="panel">
        <SectionHeading title="Customer account" description="Tenant status and commercial allowance." />
        <dl className="detail-list">
          <div><dt>Service status</dt><dd><Badge tone={statusTone(client.serviceStatus)}>{client.serviceStatus.replaceAll("_", " ")}</Badge></dd></div>
          <div><dt>Setup status</dt><dd className="capitalize">{client.onboardingStatus?.replaceAll("_", " ") || "Not reported"}</dd></div>
          <div><dt>Plan</dt><dd className="capitalize">{usage?.plan || "Unavailable"}</dd></div>
          <div><dt>Subscription</dt><dd className="capitalize">{usage?.subscriptionStatus?.replaceAll("_", " ") || "Unavailable"}</dd></div>
          <div><dt>Used this month</dt><dd>{usage ? `${Math.round(usage.usedMinutes)} minutes` : "Unavailable"}</dd></div>
          <div><dt>Customer allowance remaining</dt><dd>{usage ? `${Math.round(usage.remainingMinutes)} minutes` : "Unavailable"}</dd></div>
        </dl>
        <div className="row-actions"><Button variant="secondary" disabled={serviceAction.isPending} onClick={() => setServiceDialog(client.serviceStatus === "paused" ? "reactivate" : "suspend")}>{client.serviceStatus === "paused" ? "Reactivate service" : "Suspend service"}</Button><LinkButton to={`/admin/setup/${client.id}`} variant="secondary">Setup console</LinkButton></div>
      </Card>
      <Card className="panel">
        <SectionHeading title="Voice provider assignment" description="Operator-only guarded deployment control." />
        <dl className="detail-list">
          <div><dt>Assigned pipeline</dt><dd>{client.voicePipeline || "Not assigned"}</dd></div>
          <div><dt>Deployment state</dt><dd>{client.voicePipeline === "livekit-cascade" ? providerHealth.data?.status || "Unavailable" : client.elevenlabsAgentId ? "Configured" : "Unavailable"}</dd></div>
          <div><dt>Provider health</dt><dd><Badge tone={providerHealth.data?.status === "healthy" ? "success" : "warning"}>{providerHealth.data?.status || "Unavailable"}</Badge></dd></div>
          <div><dt>Estimated provider cost</dt><dd>{providerCost ? `£${(providerCost.estimatedCostMinor / 100).toFixed(2)} · ${providerCost.usageMinutes.toFixed(1)} min · ${providerCost.providers.join(" + ")}` : "Unavailable"}</dd></div>
        </dl>
        <div className="stack">
          <label>Target provider
            <select value={switchTarget} onChange={(event) => {
              setSwitchTarget(event.target.value as typeof switchTarget);
              setPreparedTarget(undefined);
              setPreparedDeploymentId(undefined);
              switchPreview.reset();
            }}>
              <option value="livekit-cascade">LiveKit cascade</option>
              <option value="elevenlabs-convai">ElevenLabs ConvAI</option>
            </select>
          </label>
          <ol className="muted">
            <li>Prepare an isolated staged deployment from the published tenant configuration.</li>
            <li>Run read-only provider and routing preflight.</li>
            <li>Type the confirmation and switch.</li>
          </ol>
          <Button variant="secondary" disabled={prepareProvider.isPending} onClick={() => prepareProvider.mutate()}>
            1. Prepare staged deployment
          </Button>
          {switchTarget === "livekit-cascade" && preparedDeploymentId && <div className="stack">
            <strong>2. Benchmark launch gate</strong>
            <p className="muted">Enter or paste JSON benchmark evidence. Evaluation stores an immutable operator audit and never routes calls.</p>
            <label>Baseline benchmark JSON
              <textarea rows={10} value={baselineBenchmark} onChange={(event) => setBaselineBenchmark(event.target.value)} placeholder="Paste measured baseline JSON" />
            </label>
            <label>Candidate benchmark JSON
              <textarea rows={10} value={candidateBenchmark} onChange={(event) => setCandidateBenchmark(event.target.value)} placeholder="Paste measured candidate JSON" />
            </label>
            <Button variant="secondary" disabled={evaluateGate.isPending} onClick={() => evaluateGate.mutate()}>
              Evaluate and store gate
            </Button>
            {launchGate.data && <div className="inline-notice" role="status">
              <strong>{launchGate.data.passed ? "Quality gate passed" : "Quality gate blocked"}</strong>
              <small>Evaluated {formatDate(launchGate.data.evaluatedAt)}</small>
              <ul>{launchGate.data.checks.map((check) =>
                <li key={check.key}>{check.passed ? "✓" : "×"} {check.detail}</li>)}</ul>
            </div>}
          </div>}
          <Button
            variant="secondary"
            disabled={switchPreview.isPending || preparedTarget !== switchTarget}
            onClick={() => switchPreview.mutate()}
          >
            <ShieldAlert size={15} /> 3. Run safe-switch preflight
          </Button>
          {switchPreview.data && <div className="inline-notice" role="status">
            <strong>{switchPreview.data.status === "ready" ? "Ready to switch" : "Switch blocked"}</strong>
            <ul>{switchPreview.data.checks.map((check) => <li key={check.key}>{check.passed ? "✓" : "×"} {check.detail}</li>)}</ul>
          </div>}
          {switchPreview.data?.status === "ready" && <>
            <label>Type <strong>SWITCH {client.businessName}</strong>
              <input value={switchConfirmation} onChange={(event) => setSwitchConfirmation(event.target.value)} />
            </label>
            <Button
              disabled={providerSwitch.isPending || switchConfirmation !== `SWITCH ${client.businessName}`}
              onClick={() => providerSwitch.mutate()}
            >4. Start provider switch</Button>
          </>}
          {switchStatus.data && <div className="inline-notice" role="status">
            <strong>Status: {switchStatus.data.status.replaceAll("_", " ")}</strong>
            {switchStatus.data.error && <p>{switchStatus.data.error}</p>}
          </div>}
          {switchStatus.data?.rollbackAvailable && <>
            <label>Type <strong>ROLLBACK {client.businessName}</strong>
              <input value={switchConfirmation} onChange={(event) => setSwitchConfirmation(event.target.value)} />
            </label>
            <Button
              variant="secondary"
              disabled={rollbackSwitch.isPending || switchConfirmation !== `ROLLBACK ${client.businessName}`}
              onClick={() => rollbackSwitch.mutate(switchStatus.data!.id)}
            ><RefreshCw size={15} /> Roll back provider</Button>
          </>}
        </div>
      </Card>
    </div>
    <Card className="panel">
      <SectionHeading title="Provider resources" description="Sanitized operator inventory. Credentials and provider resource identifiers remain server-side." />
      {control.isLoading ? <LoadingState label="Loading provider resources…" /> : control.error ? <ErrorState error={control.error} onRetry={() => control.refetch()} /> : resources.length ? (
        <div className="team-list">{resources.map((resource, index) => <div className="team-row" key={`${resource.provider}-${resource.resourceType}-${index}`}><Store /><div><strong>{resource.provider} · {resource.resourceType}</strong><small>Updated {formatDate(resource.updatedAt)}</small></div><Badge tone={resource.healthy ? "success" : "danger"}>{resource.assignmentState || resource.lifecycleStatus}</Badge></div>)}</div>
      ) : <EmptyState icon={Store} title="No provider resources reported" description="Resources appear after isolated provisioning begins." />}
    </Card>
    <Card className="panel">
      <SectionHeading title="Recent customer audit" description="Latest operator, billing and lifecycle actions for this tenant." />
      {audit.isLoading ? <LoadingState label="Loading customer audit…" /> : audit.error ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : audit.data?.length ? <div className="team-list">{audit.data.slice(0, 10).map((entry) => <div className="team-row" key={entry.id}><Store /><div><strong>{entry.action.replaceAll(".", " ").replaceAll("_", " ")}</strong><small>{entry.actorId} · {formatDate(entry.createdAt)}</small></div></div>)}</div> : <EmptyState icon={Store} title="No audit actions" description="Audited operator and billing actions will appear here." />}
    </Card>
    <CreditAdjustmentDialog customerName={client.businessName} open={searchParams.get("adjust") === "credits"} busy={adjustment.isPending} onClose={() => setSearchParams({}, { replace: true })} onSubmit={(minutes, reason) => adjustment.mutate({ minutes, reason })} />
    <ServiceActionDialog customerName={client.businessName} action={serviceDialog} busy={serviceAction.isPending} onClose={() => setServiceDialog(undefined)} onSubmit={(action, reason) => serviceAction.mutate({ action, reason })} />
  </>;
}

function parseBenchmark(value: string): ProviderBenchmarkMetrics {
  const parsed = JSON.parse(value) as ProviderBenchmarkMetrics;
  if (!parsed || typeof parsed !== "object") throw new Error("Benchmark must be a JSON object.");
  return parsed;
}
