import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BookOpen, Bot, CalendarDays, CheckCircle2, Clock3,
  PhoneCall, Plus, RefreshCw, ShieldCheck, Trash2, Users, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Client } from "@robinexis/api-contracts";
import { api, formatDate } from "../../lib/api";
import { usePermissions } from "../../lib/permissions";
import { workspacePath } from "../../lib/navigation";
import { useClient, useToast } from "../../state";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, LinkButton,
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
  const usage = useQuery({ queryKey: ["usage", clientId], queryFn: () => api.usage(clientId), retry: false });
  const [activationOpen, setActivationOpen] = useState(false);
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
      setActivationOpen(false);
    },
    onError: (error) => push({ title: "Activation blocked", message: error.message, tone: "error" }),
  });
  if (setup.isLoading || runs.isLoading) return <LoadingState label="Checking setup readiness…" />;
  if (setup.error || runs.error) return <ErrorState error={setup.error || runs.error} onRetry={() => { setup.refetch(); runs.refetch(); }} />;
  const client = setup.data!.client;
  const readyConnections = integrations.data?.filter((item) => item.connected).length || 0;
  const status = client.onboardingStatus || "details_required";
  return <>
    <PageHeader eyebrow="Go-live checklist" title="Four steps to a receptionist you can trust" description="Review your business, connect the customer-facing tools, make a test call, then approve the exact version that goes live." actions={<Button variant="secondary" onClick={() => { setup.refetch(); runs.refetch(); integrations.refetch(); }}><RefreshCw size={15} /> Refresh status</Button>} />
    <div className="metrics-grid metrics-compact">
      <MetricCard label="Setup status" value={status.replaceAll("_", " ")} detail={client.onboardingEta ? `Target ${formatDate(client.onboardingEta)}` : "Latest saved state"} icon={Clock3} tone="peach" />
      <MetricCard label="Readiness" value={readiness ? readiness.passed ? "Passed" : "Needs attention" : "Waiting"} detail={readiness?.generatedAt ? formatDate(readiness.generatedAt) : "No test completed yet"} icon={ShieldCheck} tone={readiness?.passed ? "sage" : "cream"} />
      <MetricCard label="Connections" value={`${readyConnections}/${integrations.data?.length || 0}`} detail={integrations.error ? "Status unavailable" : "Phone, calendar and voice"} icon={Activity} />
      <MetricCard label="Updates" value={notifications.data?.failed ? "Needs attention" : notifications.data?.pending ? "Sending" : "Delivered"} detail={notifications.data?.lastDeliveryAt ? formatDate(notifications.data.lastDeliveryAt) : "Lifecycle notification status"} icon={Activity} tone={notifications.data?.failed ? "peach" : "sage"} />
      <MetricCard label={`${usage.data?.plan || "Plan"} allowance`} value={`${usage.data?.remainingMinutes ?? 0} min`} detail={`${usage.data?.usedMinutes ?? 0} used this period`} icon={Clock3} tone={(usage.data?.remainingMinutes ?? 0) > 0 ? "sage" : "peach"} />
    </div>
    <Card className="panel">
      <SectionHeading title="Your launch path" description="Four clear stages from payment to a live receptionist." />
      <div className="team-list">
        {[
          { label: "1. Plan active", done: ["active", "trialing"].includes(client.serviceStatus), detail: "Stripe subscription and minute allowance" },
          { label: "2. Business reviewed", done: ["ready_to_provision", "provisioning", "testing", "awaiting_approval", "active"].includes(status), detail: "Website facts, services and call behaviour" },
          { label: "3. Phone and calendar connected", done: Boolean(client.requestedPhoneNumber) && readyConnections > 0, detail: "Customer-owned Twilio plus tenant-scoped Cal.com" },
          { label: "4. Tested and activated", done: status === "active", detail: "Readiness booking, cancellation and owner approval" },
        ].map((stage) => <div className="team-row" key={stage.label}>
          {stage.done ? <CheckCircle2 /> : <Clock3 />}
          <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
          <Badge tone={stage.done ? "success" : "neutral"}>{stage.done ? "Complete" : "Next"}</Badge>
        </div>)}
      </div>
    </Card>
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
          <LinkButton to={workspacePath(clientId, "business")} variant="secondary">Review business profile</LinkButton>
          <LinkButton to={workspacePath(clientId, "connections")} variant="secondary">Check phone & calendar</LinkButton>
          <LinkButton to={workspacePath(clientId, "bookings/settings")} variant="secondary">Review booking rules</LinkButton>
          <LinkButton to={workspacePath(clientId, "test")} variant="secondary">Make a test call</LinkButton>
        </div>
        {latest && <p className="muted capitalize">Provisioning {latest.status} · {(latest.step || "queued").replaceAll("_", " ")} · {formatDate(latest.updatedAt)}</p>}
        {canActivateWorkspace
          ? <Button disabled={!readiness?.passed || activate.isPending || status === "active"} onClick={() => setActivationOpen(true)}>{status === "active" ? "Already live" : "Turn on phone receptionist"}</Button>
          : <p className="muted"><ShieldCheck size={14} /> Only the workspace owner can activate. Managers can edit and publish; viewers can review.</p>}
      </Card>
    </div>
    <ConfirmDialog open={activationOpen} title="Turn on the phone receptionist?" description="The readiness-tested version will become active for this workspace. Future draft edits will not change live calls until they are approved again." confirmLabel="Turn on receptionist" busy={activate.isPending} onClose={() => setActivationOpen(false)} onConfirm={() => activate.mutate()} />
  </>;
}

type BusinessDraft = {
  businessName: string; location: string; email: string; phone: string; hours: string;
  services: Array<{ title: string; slug: string; durationMinutes: number }>;
  policies: string; prices: string;
};

function businessDraft(client?: Client): BusinessDraft {
  return {
    businessName: client?.businessName || "", location: client?.location || "", email: client?.email || "",
    phone: client?.phone || "", hours: client?.hours || "",
    services: (client?.services || []).map((item) => ({
      title: item.title,
      slug: item.slug,
      durationMinutes: item.durationMinutes,
    })),
    policies: (client?.policies || []).join("\n"), prices: client?.prices || "",
  };
}

export function BusinessPage() {
  return <WorkspaceGate>{(clientId) => <BusinessControl clientId={clientId} />}</WorkspaceGate>;
}

/** Turns a scanned fact into the text the business form expects. */
function factText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join("\n");
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

/** Scanned services become editable rows while remaining a review-only draft. */
function servicesDraft(value: unknown): BusinessDraft["services"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const service = item as { title?: string; name?: string; slug?: string; durationMinutes?: number };
      const title = service.title || service.name || "";
      if (!title) return undefined;
      const slug = service.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return { title, slug, durationMinutes: Math.max(5, service.durationMinutes || 30) };
    })
    .filter((service): service is { title: string; slug: string; durationMinutes: number } => Boolean(service));
}

function pricesText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const service = item as { title?: string; name?: string; price?: string };
      const title = service.title || service.name || "";
      return title && service.price ? `${title}: ${service.price}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function WebsiteScanCard({
  clientId,
  canEdit,
  onApply,
}: {
  clientId: string;
  canEdit: boolean;
  onApply: (facts: Record<string, unknown>) => void;
}) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const intelligence = useQuery({
    queryKey: ["website-intelligence", clientId],
    queryFn: () => api.websiteIntelligence(clientId),
    retry: false,
  });
  useEffect(() => {
    const latest = intelligence.data?.sources[0]?.url;
    if (latest) setUrl((current) => current || latest);
  }, [intelligence.data?.sources]);

  const scan = useMutation({
    mutationFn: () => api.scanWebsite(clientId, url.trim()),
    onSuccess: async (state) => {
      queryClient.setQueryData(["website-intelligence", clientId], state);
      push({
        title: "Website scanned",
        message: `${state.facts.length} details found${state.gaps.length ? `, ${state.gaps.length} still missing` : ""}`,
        tone: "success",
      });
    },
    onError: (error) => push({
      title: "Website scan failed",
      message: error.message === "firecrawl_not_configured"
        ? "The scraper is not configured yet — FIRECRAWL_API_KEY is missing on the server."
        : error.message,
      tone: "error",
    }),
  });
  const review = useMutation({
    mutationFn: (factId: string) => {
      const runId = intelligence.data?.run?.id;
      if (!runId) throw new Error("website_scan_not_found");
      return api.reviewWebsiteFact(clientId, runId, factId, { action: "confirm" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["website-intelligence", clientId] });
    },
    onError: (error) => push({ title: "Could not confirm this detail", message: error.message, tone: "error" }),
  });
  const approve = useMutation({
    mutationFn: () => {
      const runId = intelligence.data?.run?.id;
      if (!runId) throw new Error("website_scan_not_found");
      return api.approveWebsiteFacts(clientId, runId);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["website-intelligence", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["client", clientId] }),
      ]);
      push({
        title: "Website facts approved",
        message: result.indexingStatus === "failed"
          ? `Draft saved, but knowledge indexing failed: ${result.indexingError || "unknown error"}`
          : "The approved facts are saved as a draft and indexed for the receptionist. Nothing was published.",
        tone: result.indexingStatus === "failed" ? "error" : "success",
      });
    },
    onError: (error) => push({ title: "Could not approve website facts", message: error.message, tone: "error" }),
  });

  const facts = intelligence.data?.facts || [];
  const gaps = intelligence.data?.gaps || [];
  const allReviewed = facts.length > 0 && facts.every((fact) => fact.reviewStatus !== "extracted");
  return (
    <Card className="form-card">
      <SectionHeading
        title="Scan your website"
        description="Paste your public website and Robinexis reads your hours, services, prices and policies so the receptionist speaks from them. Nothing is published until you save and publish."
      />
      <div className="form-grid">
        <Field label="Website address" hint="Public pages only, for example https://bladeshair.co.uk">
          <input
            type="url"
            inputMode="url"
            placeholder="https://your-salon.co.uk"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={!canEdit || scan.isPending}
          />
        </Field>
        <Button
          type="button"
          disabled={!canEdit || !url.trim() || scan.isPending}
          onClick={() => scan.mutate()}
        >
          <RefreshCw size={15} /> {scan.isPending ? "Reading your site…" : "Scan website"}
        </Button>
      </div>
      {intelligence.data?.run?.status === "failed" && (
        <p className="muted">Last scan failed: {intelligence.data.run.error || "unknown error"}</p>
      )}
      {facts.length > 0 && (
        <>
          <div className="form-actions">
            <Badge tone="success">{facts.length} details found</Badge>
            {gaps.length > 0 && <Badge tone="warning">{gaps.length} still missing</Badge>}
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onApply(Object.fromEntries(facts.map((fact) => [fact.key, fact.value])));
                  push({ title: "Copied into the form below", message: "Review every line, then save the draft.", tone: "success" });
                }}
              >
                Fill the form from this scan
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                disabled={!allReviewed || approve.isPending}
                onClick={() => approve.mutate()}
              >
                {approve.isPending ? "Indexing…" : "Approve and index"}
              </Button>
            )}
          </div>
          <ul className="fact-list">
            {facts.map((fact) => (
              <li key={fact.id}>
                <strong>{fact.key}</strong>
                {typeof fact.confidence === "number" && (
                  <Badge tone={fact.confidence >= 0.85 ? "success" : "warning"}>
                    {Math.round(fact.confidence * 100)}% confident
                  </Badge>
                )}
                <p>{factText(fact.value).slice(0, 400)}</p>
                {canEdit && fact.reviewStatus === "extracted" && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={review.isPending}
                    onClick={() => review.mutate(fact.id)}
                  >
                    Confirm this detail
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {gaps.length > 0 && (
        <ul className="fact-list">
          {gaps.map((gap) => (
            <li key={gap.key}><strong>Still needed: {gap.key.replaceAll("_", " ")}</strong><p>{gap.detail}</p></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BusinessControl({ clientId }: { clientId: string }) {
  const { canEditWorkspace } = usePermissions(clientId);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId), retry: false });
  const initial = useMemo(() => businessDraft(client.data), [client.data]);
  const [draft, setDraft] = useState<BusinessDraft>(initial);
  useEffect(() => setDraft(initial), [initial]);
  const applyScan = (facts: Record<string, unknown>) => setDraft((current) => ({
    ...current,
    businessName: typeof facts.businessName === "string" ? facts.businessName : current.businessName,
    hours: facts.hours ? factText(facts.hours) : current.hours,
    services: facts.services ? servicesDraft(facts.services) : current.services,
    prices: facts.services ? pricesText(facts.services) || current.prices : current.prices,
    policies: facts.cancellationRules ? factText(facts.cancellationRules) : current.policies,
  }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const save = useMutation({
    mutationFn: () => api.updateClient(clientId, {
      ...draft,
      policies: draft.policies.split("\n").map((value) => value.trim()).filter(Boolean),
      services: draft.services
        .filter((service) => service.title.trim())
        .map((service) => ({
          title: service.title.trim(),
          slug: service.slug.trim() || service.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          durationMinutes: Math.max(5, Number(service.durationMinutes) || 30),
        })),
    }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["client", clientId] }), queryClient.invalidateQueries({ queryKey: ["clients"] })]);
      push({ title: "Business draft saved", message: "Conversation-impacting changes remain a draft until published.", tone: "success" });
    },
    onError: (error) => push({ title: "Could not save business profile", message: error.message, tone: "error" }),
  });
  if (client.isLoading) return <LoadingState label="Loading business profile…" />;
  if (client.error) return <ErrorState error={client.error} onRetry={() => client.refetch()} />;
  const change = (key: Exclude<keyof BusinessDraft, "services">) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft((value) => ({ ...value, [key]: event.target.value }));
  const updateService = (index: number, patch: Partial<BusinessDraft["services"][number]>) =>
    setDraft((value) => ({
      ...value,
      services: value.services.map((service, serviceIndex) =>
        serviceIndex === index ? { ...service, ...patch } : service),
    }));
  return <>
    <PageHeader eyebrow="Business" title="One source of truth for every call" description="Keep location, opening hours, services, pricing and policies accurate. Saved changes become a reviewable draft." />
    <WebsiteScanCard clientId={clientId} canEdit={canEditWorkspace} onApply={applyScan} />
    <form className="control-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={!canEditWorkspace || save.isPending}>
        <Card className="form-card"><SectionHeading title="Business profile" description={!canEditWorkspace ? "Viewer access · read only" : "Public details the receptionist may share."} /><div className="form-grid">
          <Field label="Business name"><input required value={draft.businessName} onChange={change("businessName")} /></Field>
          <Field label="Location"><input value={draft.location} onChange={change("location")} /></Field>
          <Field label="Public email"><input type="email" value={draft.email} onChange={change("email")} /></Field>
          <Field label="Public phone"><input inputMode="tel" value={draft.phone} onChange={change("phone")} /></Field>
        </div></Card>
        <Card className="form-card"><SectionHeading title="Opening hours" description="Use plain language callers will understand." /><Field label="Opening hours"><textarea rows={6} value={draft.hours} onChange={change("hours")} /></Field></Card>
        <Card className="form-card">
          <SectionHeading title="Bookable services" description="Keep the customer-facing name and appointment duration accurate." action={<Button type="button" variant="secondary" size="sm" onClick={() => setDraft((value) => ({ ...value, services: [...value.services, { title: "", slug: "", durationMinutes: 30 }] }))}><Plus size={14} /> Add service</Button>} />
          {draft.services.length ? <div className="service-editor-list">{draft.services.map((service, index) => <div className="service-editor-row" key={`${index}-${service.slug}`}>
            <Field label="Service name"><input value={service.title} onChange={(event) => updateService(index, { title: event.target.value })} /></Field>
            <Field label="Booking key" hint="Lowercase letters, numbers and hyphens"><input value={service.slug} pattern="[a-z0-9-]{2,80}" onChange={(event) => updateService(index, { slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
            <Field label="Duration (minutes)"><input type="number" min={5} step={5} value={service.durationMinutes} onChange={(event) => updateService(index, { durationMinutes: Number(event.target.value) })} /></Field>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${service.title || "service"}`} onClick={() => setDraft((value) => ({ ...value, services: value.services.filter((_, serviceIndex) => serviceIndex !== index) }))}><Trash2 size={15} /></Button>
          </div>)}</div> : <EmptyState title="No services added" description="Add the services your receptionist can discuss and book." />}
        </Card>
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
      <MetricCard label="Human transfer" value={item.transferNumber ? "Configured" : "Not configured"} detail={item.transferNumber ? "Approved fallback destination" : "Add a number for calls that need your team"} icon={Users} tone={item.transferNumber ? "sage" : "cream"} />
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
      <Card className="panel"><SectionHeading title="Resource inventory" description="Sanitized lifecycle state; credentials and provider resource IDs stay server-side." />{data.data!.resources.length ? <div className="team-list">{data.data!.resources.map((item, index) => <div className="team-row" key={`${item.clientId}-${item.provider}-${item.resourceType}-${index}`}><Activity /><div><strong>{item.businessName} · {item.provider}</strong><small>{item.resourceType}{item.assignmentState ? ` · ${item.assignmentState}` : ""}{item.accessReason ? ` · ${item.accessReason.replaceAll("_", " ")}` : ""} · {formatDate(item.updatedAt)}</small></div><Badge tone={item.healthy ? "success" : "danger"}>{item.assignmentState || item.lifecycleStatus}</Badge></div>)}</div> : <EmptyState icon={Activity} title="No provider resources" description="Inventory appears after isolated provisioning begins." />}</Card>
    </div>
    <div className="overview-grid">
      <Card className="panel"><SectionHeading title="Customer request queue" description="Support, invite and lifecycle requests across tenants." />{data.data!.requests.length ? <div className="team-list">{data.data!.requests.map((item) => <div className="team-row" key={item.id}><BookOpen /><div><strong>{item.businessName}</strong><small>{item.type.replaceAll("_", " ")} · {formatDate(item.createdAt)}</small></div><Badge tone={statusTone(item.status)}>{item.status}</Badge></div>)}</div> : <EmptyState icon={Users} title="No customer requests" description="New tenant-scoped requests will appear here." />}</Card>
      <Card className="panel"><SectionHeading title="Spend alarms" description="Configured monthly caps are visible; live provider spend is not available from the current store." />{data.data!.spendAlarms.length ? <div className="team-list">{data.data!.spendAlarms.map((item) => <div className="team-row" key={item.clientId}><ShieldCheck /><div><strong>{item.businessName}</strong><small>Monthly Twilio cap</small></div><Badge tone="success">£{(item.monthlySpendCapPence / 100).toFixed(2)}</Badge></div>)}</div> : <EmptyState icon={AlertTriangle} title="No spend caps reported" description="Configure a monthly Twilio cap before managed number purchasing." />}</Card>
    </div>
    <Card className="panel"><SectionHeading title="Platform audit" description="Latest operator and billing actions." />{audit.isLoading ? <SkeletonRows count={4} /> : audit.error ? <ErrorState error={audit.error} onRetry={() => audit.refetch()} /> : audit.data?.length ? <div className="team-list">{audit.data.slice(0, 25).map((item) => <div className="team-row" key={item.id}><Activity /><div><strong>{item.action.replaceAll(".", " ").replaceAll("_", " ")}</strong><small>{item.clientId || "Platform"} · {formatDate(item.createdAt)}</small></div></div>)}</div> : <EmptyState icon={Activity} title="No audit events" description="Operator actions will appear here." />}</Card>
  </>;
}
