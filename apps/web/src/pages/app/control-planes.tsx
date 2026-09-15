import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BookOpen, Bot, CalendarDays, CheckCircle2, Clock3,
  ExternalLink, PhoneCall, RefreshCw, ShieldCheck, Users, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Client } from "@robinexis/api-contracts";
import { api, formatDate } from "../../lib/api";
import { usePermissions } from "../../lib/permissions";
import { useClient, useToast } from "../../state";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, LinkButton,
  LoadingState, MetricCard, PageHeader, SectionHeading, SkeletonRows, statusTone,
} from "../../components/ui";

function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

function WorkspaceGate({ children }: { children: (clientId: string) => React.ReactNode }) {
  const { activeClientId, isLoading, error } = useClient();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!activeClientId) return <EmptyState title="No workspace selected" description="Choose a workspace to open its control plane." />;
  return <>{children(activeClientId)}</>;
}

export function SetupPage() {
  return <WorkspaceGate>{(clientId) => <SetupControl clientId={clientId} />}</WorkspaceGate>;
}

function SetupControl({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { canActivateWorkspace, canEditWorkspace } = usePermissions(clientId);
  const setup = useQuery({ queryKey: ["onboarding-status", clientId], queryFn: () => api.onboarding(clientId), retry: false });
  const runs = useQuery({ queryKey: ["provisioning", clientId], queryFn: () => api.provisioningRuns(clientId), retry: false });
  const integrations = useQuery({ queryKey: ["integrations", clientId], queryFn: () => api.integrations(clientId), retry: false });
  const notifications = useQuery({ queryKey: ["notification-status", clientId], queryFn: () => api.notificationStatus(clientId), retry: false });
  const latest = runs.data?.items[0];
  const readiness = latest?.output?.readinessReport;
  const blockers = readiness?.hardGaps || (latest?.error ? [latest.error] : []);
  const activate = useMutation({
    mutationFn: () => api.approveProvisioning(clientId, latest!.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["onboarding-status", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["provisioning", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
      ]);
      push({ title: "Receptionist activated", message: "The readiness-passed version is now active.", tone: "success" });
    },
    onError: (error) => push({ title: "Activation blocked", message: error.message, tone: "error" }),
  });
  if (setup.isLoading || runs.isLoading) return <LoadingState label="Checking setup readiness…" />;
  if (setup.error || runs.error) return <ErrorState error={setup.error || runs.error} onRetry={() => { setup.refetch(); runs.refetch(); }} />;
  const client = setup.data!.client;
  const readyConnections = integrations.data?.filter((item) => item.connected).length || 0;
  const status = client.onboardingStatus || "details_required";
  return <>
    <PageHeader eyebrow="Setup" title="Know exactly what is ready" description="Follow setup progress, resolve blockers, test the staged receptionist, then let the workspace owner activate it." actions={<Button variant="secondary" onClick={() => { setup.refetch(); runs.refetch(); integrations.refetch(); }}><RefreshCw size={15} /> Retry checks</Button>} />
    <div className="metrics-grid metrics-compact">
      <MetricCard label="Setup status" value={status.replaceAll("_", " ")} detail={client.onboardingEta ? `Target ${formatDate(client.onboardingEta)}` : "Latest saved state"} icon={Clock3} tone="peach" />
      <MetricCard label="Readiness" value={readiness ? readiness.passed ? "Passed" : "Blocked" : "Not run"} detail={readiness?.generatedAt ? formatDate(readiness.generatedAt) : "Waiting for isolated tests"} icon={ShieldCheck} tone={readiness?.passed ? "sage" : "cream"} />
      <MetricCard label="Connections" value={`${readyConnections}/${integrations.data?.length || 0}`} detail={integrations.error ? "Health unavailable" : "Provider health checks"} icon={Activity} />
      <MetricCard label="Updates" value={notifications.data?.failed ? "Needs attention" : notifications.data?.pending ? "Sending" : "Delivered"} detail={notifications.data?.lastDeliveryAt ? formatDate(notifications.data.lastDeliveryAt) : "Lifecycle notification status"} icon={Activity} tone={notifications.data?.failed ? "peach" : "sage"} />
    </div>
    {client.onboardingNotes && <div className="notice"><div><Activity /><span><strong>Setup update</strong> {client.onboardingNotes}</span></div></div>}
    <div className="overview-grid">
      <Card className="panel">
        <SectionHeading title="Progress and blockers" description="Failed checks prevent activation; they never silently degrade." />
        {blockers.length ? <div className="team-list">{blockers.map((blocker) => <div className="team-row" key={blocker}><XCircle className="danger-icon" /><div><strong>{blocker.replaceAll("_", " ")}</strong><small>Resolve this item, then retry readiness.</small></div><Badge tone="danger">Blocking</Badge></div>)}</div>
          : readiness?.passed ? <div className="onboarding-readiness ready"><CheckCircle2 /><div><strong>All isolated checks passed</strong><p>The owner can activate this exact staged version.</p></div></div>
            : <EmptyState icon={Clock3} title="Readiness has not run" description="Robinexis operations will stage provider resources and run isolated tests before activation." />}
      </Card>
      <Card className="panel">
        <SectionHeading title="Next actions" description={canEditWorkspace ? "Complete the missing configuration without exposing provider credentials." : "Viewer access is read-only."} />
        <div className="control-links">
          <LinkButton to="/app/business" variant="secondary">Review business profile</LinkButton>
          <LinkButton to="/app/phone" variant="secondary">Check phone</LinkButton>
          <LinkButton to="/app/calendar/settings" variant="secondary">Check calendar</LinkButton>
          <LinkButton to="/app/playground" variant="secondary">Test receptionist</LinkButton>
        </div>
        {latest && <p className="muted capitalize">Provisioning {latest.status} · {(latest.step || "queued").replaceAll("_", " ")} · {formatDate(latest.updatedAt)}</p>}
        {canActivateWorkspace
          ? <Button disabled={!readiness?.passed || activate.isPending || status === "active"} onClick={() => activate.mutate()}>{activate.isPending ? "Activating…" : status === "active" ? "Already active" : "Activate receptionist"}</Button>
          : <p className="muted"><ShieldCheck size={14} /> Only the workspace owner can activate. Managers can edit and publish; viewers can review.</p>}
      </Card>
    </div>
  </>;
}

type BusinessDraft = {
  businessName: string; location: string; email: string; phone: string; hours: string;
  services: string; policies: string; prices: string;
};

function businessDraft(client?: Client): BusinessDraft {
  return {
    businessName: client?.businessName || "", location: client?.location || "", email: client?.email || "",
    phone: client?.phone || "", hours: client?.hours || "",
    services: (client?.services || []).map((item) => `${item.title} | ${item.slug} | ${item.durationMinutes}`).join("\n"),
    policies: (client?.policies || []).join("\n"), prices: client?.prices || "",
  };
}

export function BusinessPage() {
  return <WorkspaceGate>{(clientId) => <BusinessControl clientId={clientId} />}</WorkspaceGate>;
}

function BusinessControl({ clientId }: { clientId: string }) {
  const { canEditWorkspace } = usePermissions(clientId);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId), retry: false });
  const initial = useMemo(() => businessDraft(client.data), [client.data]);
  const [draft, setDraft] = useState<BusinessDraft>(initial);
  useEffect(() => setDraft(initial), [initial]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const save = useMutation({
    mutationFn: () => api.updateClient(clientId, {
      ...draft,
      policies: draft.policies.split("\n").map((value) => value.trim()).filter(Boolean),
      services: draft.services.split("\n").map((line) => {
        const [title, slug, duration] = line.split("|").map((value) => value.trim());
        return { title, slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), durationMinutes: Math.max(5, Number(duration) || 30) };
      }).filter((service) => service.title),
    }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["client", clientId] }), queryClient.invalidateQueries({ queryKey: ["clients"] })]);
      push({ title: "Business draft saved", message: "Conversation-impacting changes remain a draft until published.", tone: "success" });
    },
    onError: (error) => push({ title: "Could not save business profile", message: error.message, tone: "error" }),
  });
  if (client.isLoading) return <LoadingState label="Loading business profile…" />;
  if (client.error) return <ErrorState error={client.error} onRetry={() => client.refetch()} />;
  const change = (key: keyof BusinessDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((value) => ({ ...value, [key]: event.target.value }));
  return <>
    <PageHeader eyebrow="Business" title="One source of truth for every call" description="Keep location, opening hours, services, pricing and policies accurate. Saved changes become a reviewable draft." />
    <form className="control-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={!canEditWorkspace || save.isPending}>
        <Card className="form-card"><SectionHeading title="Business profile" description={!canEditWorkspace ? "Viewer access · read only" : "Public details the receptionist may share."} /><div className="form-grid">
          <Field label="Business name"><input required value={draft.businessName} onChange={change("businessName")} /></Field>
          <Field label="Location"><input value={draft.location} onChange={change("location")} /></Field>
          <Field label="Public email"><input type="email" value={draft.email} onChange={change("email")} /></Field>
          <Field label="Public phone"><input inputMode="tel" value={draft.phone} onChange={change("phone")} /></Field>
        </div></Card>
        <Card className="form-card"><SectionHeading title="Hours and services" description="Use one service per line: Name | slug | minutes." /><div className="form-grid">
          <Field label="Opening hours"><textarea rows={7} value={draft.hours} onChange={change("hours")} /></Field>
          <Field label="Services"><textarea rows={7} value={draft.services} onChange={change("services")} /></Field>
        </div></Card>
        <Card className="form-card"><SectionHeading title="Prices and policies" description="Only publish facts the team has approved." /><Field label="Pricing notes"><textarea rows={5} value={draft.prices} onChange={change("prices")} /></Field><Field label="Policies" hint="One policy per line"><textarea rows={6} value={draft.policies} onChange={change("policies")} /></Field></Card>
      </fieldset>
      <div className="sticky-save"><span>{!canEditWorkspace ? "Viewer access · read only" : dirty ? "You have unsaved changes" : "All changes saved"}</span>{canEditWorkspace && <Button disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save draft"}</Button>}</div>
    </form>
  </>;
}

export function PhonePage() {
  return <WorkspaceGate>{(clientId) => <PhoneControl clientId={clientId} />}</WorkspaceGate>;
}

function PhoneControl({ clientId }: { clientId: string }) {
  const { canEditWorkspace } = usePermissions(clientId);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId), retry: false });
  const connection = useQuery({ queryKey: ["twilio-connection", clientId], queryFn: () => api.twilioConnection(clientId), retry: false });
  const [transferNumber, setTransferNumber] = useState("");
  useEffect(() => setTransferNumber(client.data?.transferNumber || ""), [client.data?.transferNumber]);
  const dirty = transferNumber !== (client.data?.transferNumber || "");
  useUnsavedChanges(dirty);
  const save = useMutation({
    mutationFn: () => api.updateClient(clientId, { transferNumber }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["client", clientId] }); push({ title: "Phone draft saved", tone: "success" }); },
    onError: (error) => push({ title: "Phone update failed", message: error.message, tone: "error" }),
  });
  if (client.isLoading || connection.isLoading) return <LoadingState label="Checking phone health…" />;
  if (client.error || connection.error) return <ErrorState error={client.error || connection.error} onRetry={() => { client.refetch(); connection.refetch(); }} />;
  const item = client.data!;
  const connected = connection.data?.status === "active";
  return <>
    <PageHeader eyebrow="Phone" title="Ownership, routing and health" description="See the verified public number and control safe human transfer. Provider credentials are never returned to this page." actions={<Button variant="secondary" onClick={() => connection.refetch()}><RefreshCw size={15} /> Retry health</Button>} />
    <div className="metrics-grid metrics-compact">
      <MetricCard label="Provider health" value={connection.data?.status.replaceAll("_", " ") || "Unknown"} detail={connection.data?.accountSidMasked || "No account returned"} icon={Activity} tone={connected ? "sage" : "peach"} />
      <MetricCard label="Inbound number" value={connection.data?.selectedPhoneNumber || item.inboundNumbers?.[0] || "Not assigned"} detail={item.phoneAcquisitionMode === "customer_oauth" ? "Customer owned" : "Robinexis managed"} icon={PhoneCall} />
      <MetricCard label="Call forwarding" value="Not available" detail="Forwarding verification is not implemented" icon={ExternalLink} />
    </div>
    <Card className="form-card">
      <SectionHeading title="Human transfer" description="Calls can transfer only to this approved destination. Saving changes creates a draft." />
      <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><fieldset disabled={!canEditWorkspace || save.isPending}>
        <Field label="Transfer number" hint="Use an international E.164 number, for example +447700900123."><input inputMode="tel" pattern="^\+[1-9][0-9]{7,14}$" value={transferNumber} onChange={(event) => setTransferNumber(event.target.value)} /></Field>
        {canEditWorkspace && <Button disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save phone draft"}</Button>}
      </fieldset></form>
    </Card>
    {!connected && <Card className="panel"><SectionHeading title="Connection required" description="Connect or verify a customer-owned Twilio number from the secure connection flow." /><LinkButton to="/app/integrations">Open connections</LinkButton></Card>}
  </>;
}

export function CalendarSettingsPage() {
  return <WorkspaceGate>{(clientId) => <CalendarSettingsControl clientId={clientId} />}</WorkspaceGate>;
}

function CalendarSettingsControl({ clientId }: { clientId: string }) {
  const { canEditWorkspace } = usePermissions(clientId);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId), retry: false });
  const connection = useQuery({ queryKey: ["calcom-connection", clientId], queryFn: () => api.calendarConnection(clientId), retry: false });
  const [timezone, setTimezone] = useState("");
  const [notice, setNotice] = useState(0);
  const [buffer, setBuffer] = useState(0);
  const [cancellationAllowed, setCancellationAllowed] = useState(true);
  const [rescheduleAllowed, setRescheduleAllowed] = useState(true);
  useEffect(() => {
    const schedule = client.data?.calendar?.schedule;
    setTimezone(schedule?.timezone || "Europe/London");
    setNotice(schedule?.minimumNoticeMinutes || 0);
    setBuffer(schedule?.bufferAfterMinutes || 0);
    setCancellationAllowed(schedule?.cancellationAllowed ?? true);
    setRescheduleAllowed(schedule?.rescheduleAllowed ?? true);
  }, [client.data]);
  const initial = client.data?.calendar?.schedule;
  const dirty = Boolean(client.data) && (timezone !== (initial?.timezone || "Europe/London") || notice !== (initial?.minimumNoticeMinutes || 0) || buffer !== (initial?.bufferAfterMinutes || 0) || cancellationAllowed !== (initial?.cancellationAllowed ?? true) || rescheduleAllowed !== (initial?.rescheduleAllowed ?? true));
  useUnsavedChanges(dirty);
  const save = useMutation({
    mutationFn: () => api.updateClient(clientId, { calendar: {
      provider: client.data?.calendar?.provider || "calcom",
      username: client.data?.calendar?.username,
      destinationCalendarId: client.data?.calendar?.destinationCalendarId,
      destinationProvider: client.data?.calendar?.destinationProvider,
      schedule: {
        timezone, minimumNoticeMinutes: notice, bufferBeforeMinutes: initial?.bufferBeforeMinutes || 0,
        bufferAfterMinutes: buffer, cancellationAllowed, rescheduleAllowed,
        weeklyHours: initial?.weeklyHours || {}, overrides: initial?.overrides || [],
      },
    } }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["client", clientId] }); push({ title: "Booking settings saved as draft", tone: "success" }); },
    onError: (error) => push({ title: "Booking settings failed", message: error.message, tone: "error" }),
  });
  if (client.isLoading || connection.isLoading) return <LoadingState label="Loading calendar settings…" />;
  if (client.error || connection.error) return <ErrorState error={client.error || connection.error} onRetry={() => { client.refetch(); connection.refetch(); }} />;
  return <>
    <PageHeader eyebrow="Calendar settings" title="Control when and how bookings happen" description="Connection, service duration, availability and booking rules remain tenant-scoped." actions={<LinkButton to="/app/calendar" variant="secondary">View bookings</LinkButton>} />
    <Card className="panel"><SectionHeading title="Connection health" description={connection.data?.accountMasked || "No calendar account connected"} /><div className="deferred-row"><CalendarDays /><div><strong className="capitalize">{connection.data?.status.replaceAll("_", " ")}</strong><p>{connection.data?.destinationCalendarId ? "A booking destination is selected." : "Choose a destination before accepting live bookings."}</p></div><LinkButton to="/app/integrations" variant="secondary">Manage connection</LinkButton></div></Card>
    <form className="control-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><fieldset disabled={!canEditWorkspace || save.isPending}>
      <Card className="form-card"><SectionHeading title="Booking rules" description={!canEditWorkspace ? "Viewer access · read only" : "Changes remain a draft until published."} /><div className="form-grid">
        <Field label="Timezone"><input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field>
        <Field label="Minimum notice (minutes)"><input type="number" min={0} value={notice} onChange={(event) => setNotice(Number(event.target.value))} /></Field>
        <Field label="Buffer after appointments (minutes)"><input type="number" min={0} value={buffer} onChange={(event) => setBuffer(Number(event.target.value))} /></Field>
      </div><label className="check-row"><input type="checkbox" checked={cancellationAllowed} onChange={(event) => setCancellationAllowed(event.target.checked)} /> Allow the receptionist to cancel confirmed bookings</label><label className="check-row"><input type="checkbox" checked={rescheduleAllowed} onChange={(event) => setRescheduleAllowed(event.target.checked)} /> Allow the receptionist to reschedule confirmed bookings</label></Card>
    </fieldset><div className="sticky-save"><span>{!canEditWorkspace ? "Viewer access · read only" : dirty ? "You have unsaved changes" : "All changes saved"}</span>{canEditWorkspace && <Button disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save booking draft"}</Button>}</div></form>
    <Card className="panel"><SectionHeading title="Services, weekly hours and overrides" description="Service durations are managed in Business. Weekly hours and dated overrides are preserved from onboarding; a structured editor is not yet available." /><div className="control-links"><LinkButton to="/app/business" variant="secondary">Edit services and hours</LinkButton><LinkButton to="/app/support" variant="secondary">Request an override</LinkButton></div></Card>
  </>;
}

export function AdminControlPlanePage() {
  const data = useQuery({ queryKey: ["admin-control-plane"], queryFn: api.adminControlPlane, retry: false });
  const audit = useQuery({ queryKey: ["admin-audit"], queryFn: () => api.adminAudit(), retry: false });
  if (data.isLoading) return <LoadingState label="Loading platform controls…" />;
  if (data.error) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const failed = data.data!.provisioning.filter((item) => item.runStatus === "failed" || item.blockers.length);
  const unhealthy = data.data!.resources.filter((item) => !item.healthy);
  return <>
    <PageHeader eyebrow="Operator admin" title="Platform control plane" description="Tenant-safe provisioning, resource health, customer requests, spend safeguards and immutable activity." actions={<Button variant="secondary" onClick={() => { data.refetch(); audit.refetch(); }}><RefreshCw size={15} /> Refresh</Button>} />
    <div className="metrics-grid metrics-compact">
      <MetricCard label="Provisioning queue" value={data.data!.provisioning.length} detail={`${failed.length} blocked or failed`} icon={Clock3} tone="peach" />
      <MetricCard label="Resources" value={data.data!.resources.length} detail={`${unhealthy.length} need attention`} icon={Activity} />
      <MetricCard label="Customer requests" value={data.data!.requests.filter((item) => item.status === "pending").length} detail="Pending operator review" icon={Users} />
      <MetricCard label="Spend caps" value={data.data!.spendAlarms.length} detail="Configured Twilio safeguards" icon={ShieldCheck} tone="sage" />
      <MetricCard label="Notification health" value={data.data!.health.status} detail={`${data.data!.health.notificationQueue.pending} queued · ${data.data!.health.notificationQueue.providerFailures24h} provider failures`} icon={Activity} tone={data.data!.health.status === "ok" ? "sage" : "peach"} />
      <MetricCard label="Backup freshness" value={data.data!.health.backup.freshness} detail={data.data!.health.backup.status.replaceAll("_", " ")} icon={ShieldCheck} />
    </div>
    <Card className="panel"><SectionHeading title="Blades baseline status" description="Protected baseline health only; no provider identifiers or prompt content are exposed." /><div className="deferred-row"><Bot /><div><strong>{data.data!.blades.present ? "Baseline tenant present" : "Baseline tenant missing"}</strong><p>{data.data!.blades.published ? "Published" : "Not published"} · {data.data!.blades.inboundActive ? "Inbound active" : "Inbound inactive"} · {data.data!.blades.serviceStatus || "No service status"}</p></div><Badge tone={data.data!.blades.present && data.data!.blades.published ? "success" : "warning"}>{data.data!.blades.present ? "Tracked" : "Attention"}</Badge></div></Card>
    <div className="overview-grid">
      <Card className="panel"><SectionHeading title="Provisioning and failed jobs" description="Open a tenant setup console to review readiness, retry a failed run, pause work, or record review." />{data.data!.provisioning.length ? <div className="team-list">{data.data!.provisioning.map((item) => <div className="team-row" key={item.clientId}><span className="client-avatar">{item.businessName.slice(0, 2).toUpperCase()}</span><div><strong>{item.businessName}</strong><small>{item.step?.replaceAll("_", " ") || item.onboardingStatus?.replaceAll("_", " ") || "Queued"}</small></div><Badge tone={statusTone(item.runStatus)}>{item.runStatus || "waiting"}</Badge><Link className="button button-secondary button-sm" to={`/admin/setup/${item.clientId}`}>Actions</Link></div>)}</div> : <EmptyState icon={CheckCircle2} title="Provisioning queue is clear" description="No staged or failed provisioning work was returned." />}</Card>
      <Card className="panel"><SectionHeading title="Resource inventory" description="Sanitized lifecycle state; credentials and provider resource IDs stay server-side." />{data.data!.resources.length ? <div className="team-list">{data.data!.resources.map((item, index) => <div className="team-row" key={`${item.clientId}-${item.provider}-${item.resourceType}-${index}`}><Activity /><div><strong>{item.businessName} · {item.provider}</strong><small>{item.resourceType} · {formatDate(item.updatedAt)}</small></div><Badge tone={item.healthy ? "success" : "danger"}>{item.lifecycleStatus}</Badge></div>)}</div> : <EmptyState icon={Activity} title="No provider resources" description="Inventory appears after isolated provisioning begins." />}</Card>
    </div>
    <div className="overview-grid">
      <Card className="panel"><SectionHeading title="Customer request queue" description="Support, invite and lifecycle requests across tenants." />{data.data!.requests.length ? <div className="team-list">{data.data!.requests.map((item) => <div className="team-row" key={item.id}><BookOpen /><div><strong>{item.businessName}</strong><small>{item.type.replaceAll("_", " ")} · {formatDate(item.createdAt)}</small></div><Badge tone={statusTone(item.status)}>{item.status}</Badge></div>)}</div> : <EmptyState icon={Users} title="No customer requests" description="New tenant-scoped requests will appear here." />}</Card>
      <Card className="panel"><SectionHeading title="Spend alarms" description="Configured monthly caps are visible; live provider spend is not available from the current store." />{data.data!.spendAlarms.length ? <div className="team-list">{data.data!.spendAlarms.map((item) => <div className="team-row" key={item.clientId}><ShieldCheck /><div><strong>{item.businessName}</strong><small>Monthly Twilio cap</small></div><Badge tone="success">£{(item.monthlySpendCapPence / 100).toFixed(2)}</Badge></div>)}</div> : <EmptyState icon={AlertTriangle} title="No spend caps reported" description="Configure a monthly Twilio cap before managed number purchasing." />}</Card>
    </div>
    <Card className="panel"><SectionHeading title="Platform audit" description="Latest operator and billing actions." />{audit.isLoading ? <SkeletonRows count={4} /> : audit.error ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : audit.data?.length ? <div className="team-list">{audit.data.slice(0, 25).map((item) => <div className="team-row" key={item.id}><Activity /><div><strong>{item.action.replaceAll(".", " ").replaceAll("_", " ")}</strong><small>{item.clientId || "Platform"} · {formatDate(item.createdAt)}</small></div></div>)}</div> : <EmptyState icon={Activity} title="No audit events" description="Operator actions will appear here." />}</Card>
  </>;
}
