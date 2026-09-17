import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Plus, Search, Store, Users } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, formatDate, initials } from "../../lib/api";
import { filterClients } from "../../lib/admin";
import { useClient, useToast } from "../../state";
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, LoadingState, PageHeader, SectionHeading, statusTone } from "../../components/ui";
import { CreditAdjustmentDialog } from "./credit-adjustment-dialog";
import { ServiceActionDialog } from "./service-action-dialog";
import { ProviderSwitchPanel } from "../../components/admin/provider-switch-panel";

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
  const [serviceDialog, setServiceDialog] = useState<"suspend" | "reactivate">();
  const customer = useQuery({ queryKey: ["client", id], queryFn: () => api.client(id!), enabled: Boolean(id), retry: false });
  const summary = useQuery({ queryKey: ["admin-summary"], queryFn: api.adminSummary, retry: false });
  const control = useQuery({ queryKey: ["admin-control-plane"], queryFn: api.adminControlPlane, retry: false });
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
      <ProviderSwitchPanel client={client} providerCost={providerCost} />
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
