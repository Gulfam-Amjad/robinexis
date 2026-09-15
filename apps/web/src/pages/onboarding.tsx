import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Client,
  OnboardingReadinessBlocker,
  OnboardingWizardData,
  OnboardingWizardState,
  OnboardingWizardStep,
  WebsiteIntelligenceFact,
} from "@robinexis/api-contracts";
import { Check, ChevronLeft, ChevronRight, Globe2, Loader2, Save, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button, Field } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useSession } from "../state";

const steps: Array<{ id: OnboardingWizardStep; label: string; title: string; copy: string }> = [
  { id: "website", label: "Website", title: "Start with your website", copy: "We’ll scan your public site for useful business details. Nothing is published automatically." },
  { id: "facts", label: "Review facts", title: "Check what we found", copy: "Confirm or correct each fact before it becomes part of your receptionist brief." },
  { id: "behavior", label: "Calls", title: "Shape every conversation", copy: "Set the welcome, tone, safe handover and recording-consent behaviour." },
  { id: "operations", label: "Services", title: "Add services and booking rules", copy: "Give callers accurate hours, service durations and booking expectations." },
  { id: "phone", label: "Phone", title: "Choose your phone route", copy: "We’ll confirm number availability and routing before making any change." },
  { id: "calendar", label: "Calendar", title: "Choose your calendar route", copy: "Select how booking should be set up. Connections happen during specialist setup." },
  { id: "review", label: "Review", title: "Review your setup brief", copy: "Resolve any blockers, then send the brief for specialist setup, testing and your approval." },
];

interface OnboardingView {
  client?: Client;
  wizard: OnboardingWizardState;
  readiness: { ready: boolean; blockers: OnboardingReadinessBlocker[] };
}

/**
 * Tolerates older API responses and partial payloads: anything without a usable
 * wizard returns undefined so the page offers recovery instead of crashing.
 */
function onboardingView(payload: unknown): OnboardingView | undefined {
  const body = (payload ?? {}) as Record<string, unknown>;
  const wizard = (body.wizard ?? undefined) as Partial<OnboardingWizardState> | undefined;
  const currentStep = steps.find((step) => step.id === wizard?.currentStep)?.id;
  if (!wizard || !currentStep) return undefined;
  const readiness = (body.readiness ?? {}) as Record<string, unknown>;
  const blockers = (Array.isArray(readiness.blockers) ? readiness.blockers : [])
    .filter((blocker): blocker is OnboardingReadinessBlocker =>
      Boolean(blocker) && typeof (blocker as OnboardingReadinessBlocker).key === "string");
  return {
    client: (body.client ?? undefined) as Client | undefined,
    wizard: {
      clientId: typeof wizard.clientId === "string" ? wizard.clientId : "",
      currentStep,
      completedSteps: (Array.isArray(wizard.completedSteps) ? wizard.completedSteps : [])
        .filter((step): step is OnboardingWizardStep => steps.some((known) => known.id === step)),
      data: wizard.data && typeof wizard.data === "object" ? wizard.data : {},
      version: Number.isFinite(wizard.version) ? Number(wizard.version) : 0,
      createdAt: String(wizard.createdAt ?? ""),
      updatedAt: String(wizard.updatedAt ?? ""),
      submittedAt: typeof wizard.submittedAt === "string" ? wizard.submittedAt : undefined,
    },
    readiness: { ready: Boolean(readiness.ready) && !blockers.length, blockers },
  };
}

function servicesFromText(value: string) {
  return value.split("\n").map((line) => {
    const [title = "", duration = ""] = line.split("|").map((item) => item.trim());
    return {
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      durationMinutes: Number(duration),
    };
  }).filter((service) => service.title || service.durationMinutes);
}

function servicesToText(services: OnboardingWizardData["services"]) {
  return (services || []).map((service) => `${service.title} | ${service.durationMinutes}`).join("\n");
}

function FactRow({
  fact,
  pending,
  onReview,
}: {
  fact: WebsiteIntelligenceFact;
  pending: boolean;
  onReview: (action: "confirm" | "edit", value?: unknown) => void;
}) {
  const initial = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value, null, 2);
  const [value, setValue] = useState(initial);
  const changed = value !== initial;
  let parsed: unknown = value;
  if (typeof fact.value !== "string") {
    try { parsed = JSON.parse(value); } catch { parsed = value; }
  }
  return (
    <article className={`onboarding-fact ${fact.reviewStatus !== "extracted" ? "reviewed" : ""}`}>
      <div className="onboarding-fact-heading">
        <strong>{fact.key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</strong>
        <span>{fact.reviewStatus === "extracted" ? "Needs review" : fact.reviewStatus}</span>
      </div>
      <textarea aria-label={`${fact.key} value`} rows={Math.min(8, Math.max(2, value.split("\n").length))} value={value} onChange={(event) => setValue(event.target.value)} />
      {fact.evidence ? <small>Source evidence is retained for the specialist review.</small> : null}
      <div className="onboarding-fact-actions">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => onReview(changed ? "edit" : "confirm", changed ? parsed : undefined)}>
          {changed ? "Save correction" : fact.reviewStatus === "extracted" ? "Confirm" : "Confirmed"}
        </Button>
      </div>
    </article>
  );
}

function SetupProgress({
  status,
  notes,
  eta,
  provisioning,
  approving,
  approvalError,
  canApprove,
  onApprove,
}: {
  status?: string;
  notes?: string;
  eta?: string;
  provisioning?: import("@robinexis/api-contracts").ProvisioningStatus | null;
  approving: boolean;
  approvalError?: string;
  canApprove: boolean;
  onApprove: () => void;
}) {
  const needsAttention = status === "needs_attention";
  const inProgress = ["setup_in_progress", "provisioning", "testing"].includes(status || "");
  const awaitingApproval = status === "awaiting_approval";
  const queued = status === "setup_queued";
  const report = provisioning?.output?.readinessReport;
  return (
    <main className="onboarding-page">
      <header className="onboarding-header"><Link className="logo" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link></header>
      <section className="onboarding-status-card">
        <span className="eyebrow">Assisted setup</span>
        <h1>{needsAttention ? "We need one more detail" : awaitingApproval ? "Your receptionist is ready for approval" : inProgress ? "Your setup is in progress" : queued ? "Your setup is in the queue" : "Your setup is ready"}</h1>
        <p>{needsAttention
          ? "Setup is paused safely. A Robinexis specialist will contact you before anything goes live."
          : "Your brief is saved. We’ll configure and test the receptionist, then ask you to approve it before activation."}</p>
        <div className="setup-progress" role="status">
          {["Brief received", "Specialist setup", "Test call", "Your approval"].map((step, index) => (
            <div className={index < (inProgress ? 2 : 1) ? "complete" : needsAttention && index === 1 ? "attention" : ""} key={step}>
              <span>{index + 1}</span><p><strong>{step}</strong><small>{index === 3 ? "Required before activation" : index === 0 ? "Complete" : "Robinexis handles this with you"}</small></p>
            </div>
          ))}
        </div>
        {(notes || eta) && <div className="auth-note"><p>{notes || "Your setup is progressing."}{eta ? ` Target: ${new Date(eta).toLocaleString("en-GB")}.` : ""}</p></div>}
        {status === "ready_to_provision" && !provisioning && <div className="auth-note">
          <p>Your onboarding prechecks passed. Provider automation is disabled or has not started, so no provider changes have been made.</p>
        </div>}
        {report && <div className={`onboarding-readiness ${report.passed ? "ready" : ""}`}>
          <ShieldCheck />
          <div>
            <strong>{report.passed ? "Automated readiness tests passed" : "Readiness tests need review"}</strong>
            <p>{report.checks.map((check) => `${check.key.replaceAll("_", " ")}: ${check.status}`).join(" · ")}</p>
            {report.syntheticBooking?.cancelled && <small>Synthetic booking created and cancelled; no test booking remains.</small>}
          </div>
        </div>}
        {report?.testCallLink && <a className="button button-secondary button-md full-button" href={report.testCallLink}>Open safe test call</a>}
        {awaitingApproval && report?.passed && provisioning?.id && canApprove && <Button type="button" disabled={approving} onClick={onApprove}>
          {approving ? "Activating…" : "Approve and activate"}
        </Button>}
        {approvalError && <div className="form-alert" role="alert">{approvalError}</div>}
        <Link className="button button-secondary button-md full-button" to="/billing">Manage billing</Link>
        <a className="button button-ghost button-md full-button" href="mailto:hello@robinexis.com">Contact setup support</a>
      </section>
    </main>
  );
}

function OnboardingUnavailable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <main className="onboarding-page">
      <header className="onboarding-header"><Link className="logo" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link></header>
      <section className="onboarding-status-card" role="alert">
        <span className="eyebrow">Assisted setup</span>
        <h1>We couldn’t load your setup</h1>
        <p>Anything you saved already is safe in your workspace. Try again, or contact us and a specialist will pick up your setup with you.</p>
        <Button type="button" disabled={retrying} onClick={onRetry}>{retrying ? "Trying again…" : "Try again"}</Button>
        <a className="button button-ghost button-md full-button" href="mailto:hello@robinexis.com">Contact setup support</a>
      </section>
    </main>
  );
}

export function SelfServeOnboardingPage() {
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const clientId = actor?.clientId;
  const onboarding = useQuery({
    queryKey: ["onboarding-wizard", clientId],
    queryFn: () => api.onboardingWizard(clientId!),
    enabled: Boolean(clientId),
  });
  const view = onboardingView(onboarding.data);
  const website = useQuery({
    queryKey: ["website-intelligence", clientId],
    queryFn: () => api.websiteIntelligence(clientId!),
    enabled: Boolean(clientId && view?.wizard.data.websiteRunId),
  });
  const twilio = useQuery({
    queryKey: ["twilio-connection", clientId],
    queryFn: () => api.twilioConnection(clientId!),
    enabled: Boolean(clientId),
    retry: false,
  });
  const runId = website.data?.run?.id;
  const [data, setData] = useState<OnboardingWizardData>({});
  const [servicesText, setServicesText] = useState("");
  const [overrideDate, setOverrideDate] = useState("");
  const [hydratedVersion, setHydratedVersion] = useState(-1);

  useEffect(() => {
    if (!view || view.wizard.version === hydratedVersion) return;
    setData(view.wizard.data);
    setServicesText(servicesToText(view.wizard.data.services));
    setHydratedVersion(view.wizard.version);
  }, [hydratedVersion, view]);

  const save = useMutation({
    mutationFn: (input: { currentStep?: OnboardingWizardStep; completedStep?: OnboardingWizardStep; data?: Partial<OnboardingWizardData> }) =>
      api.saveOnboardingWizard(clientId!, { ...input, expectedVersion: view?.wizard.version || undefined }),
    onSuccess: (result) => {
      if (!result?.wizard) {
        void onboarding.refetch();
        return;
      }
      queryClient.setQueryData(["onboarding-wizard", clientId], (current: typeof onboarding.data) =>
        current ? { ...current, wizard: result.wizard, readiness: result.readiness } : current);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void onboarding.refetch();
    },
  });
  const scan = useMutation({
    mutationFn: (url: string) => api.scanWebsite(clientId!, url),
    onSuccess: async (result) => {
      const scannedRunId = result.run?.id;
      if (!scannedRunId) throw new Error("The scan finished without results. Please try again.");
      await api.saveOnboardingWizard(clientId!, {
        data: { websiteUrl: data.websiteUrl, websiteRunId: scannedRunId },
        currentStep: "facts",
        completedStep: "website",
      });
      await Promise.all([onboarding.refetch(), website.refetch()]);
    },
  });
  const reviewFact = useMutation({
    mutationFn: (input: { factId: string; action: "confirm" | "edit"; value?: unknown }) => {
      if (!runId) throw new Error("This scan is no longer available. Re-run the website scan.");
      return api.reviewWebsiteFact(clientId!, runId, input.factId, input);
    },
    onSuccess: () => website.refetch(),
  });
  const approve = useMutation({
    mutationFn: () => {
      if (!runId) throw new Error("This scan is no longer available. Re-run the website scan.");
      return api.approveWebsiteFacts(clientId!, runId);
    },
    onSuccess: async () => {
      await website.refetch();
      await save.mutateAsync({
        data: { businessName: data.businessName, location: data.location },
        currentStep: "behavior",
        completedStep: "facts",
      });
    },
  });
  const submit = useMutation({
    mutationFn: () => api.submitOnboardingWizard(clientId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session-actor"] }),
        onboarding.refetch(),
      ]);
    },
  });
  const connectTwilio = useMutation({
    mutationFn: () => api.startTwilioConnection(clientId!),
    onSuccess: ({ url }) => { window.location.assign(url); },
  });
  const disconnectTwilio = useMutation({
    mutationFn: () => api.disconnectTwilio(clientId!),
    onSuccess: () => twilio.refetch(),
  });
  const activate = useMutation({
    mutationFn: () => {
      const runId = onboarding.data?.provisioning?.id;
      if (!runId) throw new Error("The provisioning report is unavailable.");
      return api.approveProvisioning(clientId!, runId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session-actor"] });
    },
  });

  if (!clientId) return <Navigate to="/billing" replace />;
  if (actor.subscriptionStatus !== "active" && actor.subscriptionStatus !== "trialing") return <Navigate to="/billing" replace />;
  if (actor.onboardingStatus === "active") return <Navigate to="/app" replace />;
  if (["setup_queued", "setup_in_progress", "ready_to_provision", "provisioning", "testing", "awaiting_approval", "needs_attention"].includes(actor.onboardingStatus || "")) {
    return <SetupProgress
      status={actor.onboardingStatus}
      notes={view?.client?.onboardingNotes}
      eta={view?.client?.onboardingEta}
      provisioning={onboarding.data?.provisioning}
      approving={activate.isPending}
      approvalError={activate.error?.message}
      canApprove={actor.clientRoles[clientId] === "owner"}
      onApprove={() => activate.mutate()}
    />;
  }
  if (onboarding.isPending) return <div className="onboarding-loading" role="status"><Loader2 className="spin" /> Loading your saved setup…</div>;
  if (!view) {
    return <OnboardingUnavailable retrying={onboarding.isFetching} onRetry={() => void onboarding.refetch()} />;
  }

  const wizard = view.wizard;
  const readiness = view.readiness;
  const facts = website.data?.facts ?? [];
  const openGaps = (website.data?.gaps ?? []).filter((gap) => gap.status === "open");
  const active = steps.find((step) => step.id === wizard.currentStep) || steps[0];
  const stepIndex = steps.findIndex((step) => step.id === active.id);
  const update = <K extends keyof OnboardingWizardData>(key: K, value: OnboardingWizardData[K]) =>
    setData((current) => ({ ...current, [key]: value }));
  const schedule = data.calendarSchedule || {
    timezone: data.timezone || "Europe/London",
    weeklyHours: {},
    overrides: [],
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 60,
    cancellationAllowed: true,
    rescheduleAllowed: true,
  };
  const updateSchedule = (patch: Partial<typeof schedule>) =>
    update("calendarSchedule", { ...schedule, ...patch });
  const stepData = (): Partial<OnboardingWizardData> => {
    if (active.id === "website") return { websiteUrl: data.websiteUrl };
    if (active.id === "facts") return { businessName: data.businessName, location: data.location };
    if (active.id === "behavior") return {
      greeting: data.greeting, tone: data.tone, transferNumber: data.transferNumber, recordingConsent: data.recordingConsent,
    };
    if (active.id === "operations") return {
      services: servicesFromText(servicesText), hours: data.hours, timezone: data.timezone, bookingRules: data.bookingRules,
    };
    if (active.id === "phone") return { phoneMode: data.phoneMode, customerPhoneNumber: data.customerPhoneNumber };
    if (active.id === "calendar") return {
      calendarMode: data.calendarMode,
      existingCalendarProvider: data.existingCalendarProvider,
      calendarSchedule: data.calendarSchedule,
    };
    return data;
  };
  const go = async (direction: -1 | 1) => {
    const target = steps[Math.max(0, Math.min(steps.length - 1, stepIndex + direction))]!;
    await save.mutateAsync({
      data: stepData(),
      currentStep: target.id,
      completedStep: direction === 1 ? active.id : undefined,
    });
  };

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <Link className="logo" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link>
        <span><Save size={14} /> Saved securely to your workspace</span>
      </header>
      <div className="onboarding-shell">
        <nav className="onboarding-steps" aria-label="Onboarding progress">
          <p>Setup progress</p>
          <ol>{steps.map((step, index) => (
            <li key={step.id}>
              <button
                type="button"
                aria-current={step.id === active.id ? "step" : undefined}
                className={step.id === active.id ? "active" : wizard.completedSteps.includes(step.id) ? "complete" : ""}
                onClick={() => save.mutate({ data: stepData(), currentStep: step.id })}
              >
                <span>{wizard.completedSteps.includes(step.id) ? <Check size={14} /> : index + 1}</span>{step.label}
              </button>
            </li>
          ))}</ol>
          <div className="onboarding-trial-note"><ShieldCheck size={18} /><p><strong>Trial setup, safely staged</strong>Your receptionist will not go live until specialist testing and your approval are complete.</p></div>
        </nav>
        <section className="onboarding-workspace">
          <span className="eyebrow">Step {stepIndex + 1} of {steps.length}</span>
          <h1>{active.title}</h1>
          <p className="onboarding-intro">{active.copy}</p>

          {active.id === "website" && <div className="onboarding-form">
            <Field label="Business website" hint="Use the public homepage, including https://">
              <div className="onboarding-inline">
                <input type="url" placeholder="https://yourbusiness.co.uk" value={data.websiteUrl || ""} onChange={(event) => update("websiteUrl", event.target.value)} />
                <Button type="button" disabled={scan.isPending || !data.websiteUrl} onClick={() => scan.mutate(data.websiteUrl!)}><Globe2 size={16} />{scan.isPending ? "Scanning…" : "Scan website"}</Button>
              </div>
            </Field>
            <div className="onboarding-callout"><strong>What happens next?</strong><p>We extract likely services, hours, contact details and policies. You review every item before it is approved for setup.</p></div>
            {scan.error && <div className="form-alert" role="alert">{scan.error.message}</div>}
          </div>}

          {active.id === "facts" && <div className="onboarding-form">
            {!facts.length ? <div className="onboarding-callout"><p>No scan results are available yet. Return to Website and run a scan.</p></div> : (
              <>
                <div className="onboarding-facts">{facts.map((fact) =>
                  <FactRow key={`${fact.id}-${fact.reviewStatus}`} fact={fact} pending={reviewFact.isPending} onReview={(action, value) => reviewFact.mutate({ factId: fact.id, action, value })} />
                )}</div>
                {openGaps.length > 0 && <div className="onboarding-callout warning">
                  <strong>Details the website could not confirm</strong>
                  <ul>{openGaps.map((gap) => <li key={gap.id}>{gap.detail || gap.key}</li>)}</ul>
                </div>}
                <Field label="Business name"><input value={data.businessName || ""} onChange={(event) => update("businessName", event.target.value)} /></Field>
                <Field label="Location (optional)"><input value={data.location || ""} onChange={(event) => update("location", event.target.value)} /></Field>
                {(reviewFact.error || approve.error) && <div className="form-alert" role="alert">{(reviewFact.error || approve.error)!.message}</div>}
                <Button type="button" disabled={approve.isPending || facts.some((fact) => fact.reviewStatus === "extracted")} onClick={() => approve.mutate()}>
                  {approve.isPending ? "Approving…" : "Approve reviewed facts"}
                </Button>
              </>
            )}
          </div>}

          {active.id === "behavior" && <div className="onboarding-form">
            <Field label="Opening greeting"><textarea rows={3} value={data.greeting || ""} onChange={(event) => update("greeting", event.target.value)} /></Field>
            <Field label="Tone"><input placeholder="Warm, concise and reassuring" value={data.tone || ""} onChange={(event) => update("tone", event.target.value)} /></Field>
            <Field label="Transfer number" hint="The person or team to receive a caller when human help is needed.">
              <input inputMode="tel" placeholder="+447700900123" value={data.transferNumber || ""} onChange={(event) => update("transferNumber", event.target.value)} />
            </Field>
            <Field label="Recording consent">
              <select value={data.recordingConsent || ""} onChange={(event) => update("recordingConsent", event.target.value as OnboardingWizardData["recordingConsent"])}>
                <option value="">Choose an approach</option>
                <option value="always_ask">Ask the caller before recording</option>
                <option value="announcement">Play a recording notice at the start</option>
                <option value="not_recording">Do not record calls</option>
              </select>
            </Field>
          </div>}

          {active.id === "operations" && <div className="onboarding-form">
            <Field label="Services" hint="One per line: Service name | duration in minutes">
              <textarea rows={6} placeholder={"Consultation | 30\nFollow-up | 45"} value={servicesText} onChange={(event) => setServicesText(event.target.value)} />
            </Field>
            <Field label="Opening hours"><textarea rows={4} placeholder="Monday–Friday, 9am–5pm" value={data.hours || ""} onChange={(event) => update("hours", event.target.value)} /></Field>
            <Field label="Timezone">
              <select value={data.timezone || "Europe/London"} onChange={(event) => update("timezone", event.target.value)}>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Dublin">Europe/Dublin</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Australia/Sydney">Australia/Sydney</option>
              </select>
            </Field>
            <Field label="Booking rules" hint="Include notice periods, deposits, cancellations, buffers or caller details to collect.">
              <textarea rows={5} value={data.bookingRules || ""} onChange={(event) => update("bookingRules", event.target.value)} />
            </Field>
          </div>}

          {active.id === "phone" && <div className="onboarding-choice-grid">
            <label className={data.phoneMode === "managed" ? "selected" : ""}><input type="radio" name="phoneMode" checked={data.phoneMode === "managed"} onChange={() => update("phoneMode", "managed")} /><strong>Managed phone setup</strong><span>Robinexis will discuss a suitable number and routing with you. UK number availability and timing are confirmed during setup.</span></label>
            <label className={data.phoneMode === "customer_twilio" ? "selected" : ""}><input type="radio" name="phoneMode" checked={data.phoneMode === "customer_twilio"} onChange={() => update("phoneMode", "customer_twilio")} /><strong>Use customer Twilio</strong><span>Tell us which Twilio number you want assessed. Connection and routing happen later with a specialist.</span></label>
            {data.phoneMode === "customer_twilio" && <>
              <Field label="Twilio phone number"><input inputMode="tel" placeholder="+44…" value={data.customerPhoneNumber || ""} onChange={(event) => update("customerPhoneNumber", event.target.value)} /></Field>
              <div className="onboarding-callout">
                <strong>Twilio connection: {twilio.data?.status?.replaceAll("_", " ") || "not connected"}</strong>
                <p>{twilio.data?.verifiedPhoneNumber
                  ? `${twilio.data.verifiedPhoneNumber} is verified as owned by this Twilio account.`
                  : "Connect the account, then add an API key and verify the selected owned number."}</p>
                <div className="onboarding-inline">
                  {twilio.data?.status !== "active" && <Button type="button" variant="secondary" disabled={connectTwilio.isPending} onClick={() => connectTwilio.mutate()}>
                    {twilio.data?.canReconnect ? "Reconnect Twilio" : "Connect Twilio"}
                  </Button>}
                  <Link className="button button-ghost button-md" to="/app/integrations">Manage and verify number</Link>
                  {twilio.data && twilio.data.status !== "not_connected" && <Button type="button" variant="ghost" disabled={disconnectTwilio.isPending} onClick={() => disconnectTwilio.mutate()}>Disconnect</Button>}
                </div>
                {(connectTwilio.error || disconnectTwilio.error) && <div className="form-alert" role="alert">{(connectTwilio.error || disconnectTwilio.error)!.message}</div>}
              </div>
            </>}
          </div>}

          {active.id === "calendar" && <div className="onboarding-choice-grid">
            <label className={data.calendarMode === "managed_calcom" ? "selected" : ""}><input type="radio" name="calendarMode" checked={data.calendarMode === "managed_calcom"} onChange={() => update("calendarMode", "managed_calcom")} /><strong>Managed Cal.com setup</strong><span>Robinexis will prepare booking types from your approved services and confirm them with you.</span></label>
            <label className={data.calendarMode === "connect_existing" ? "selected" : ""}><input type="radio" name="calendarMode" checked={data.calendarMode === "connect_existing"} onChange={() => update("calendarMode", "connect_existing")} /><strong>Connect an existing calendar</strong><span>Choose the system. Secure connection is completed during specialist setup, not in this wizard.</span></label>
            {data.calendarMode === "connect_existing" && <Field label="Calendar provider"><select value={data.existingCalendarProvider || ""} onChange={(event) => update("existingCalendarProvider", event.target.value as OnboardingWizardData["existingCalendarProvider"])}><option value="">Choose provider</option><option value="calcom">Cal.com</option><option value="google">Google Calendar</option><option value="outlook">Outlook</option><option value="fresha">Fresha</option></select></Field>}
            <div className="form-grid">
              <Field label="Booking timezone"><input value={schedule.timezone} onChange={(event) => updateSchedule({ timezone: event.target.value })} placeholder="Europe/London" /></Field>
              <Field label="Weekday opening time"><input type="time" value={schedule.weeklyHours.monday?.[0]?.start || ""} onChange={(event) => {
                const end = schedule.weeklyHours.monday?.[0]?.end || "17:00";
                updateSchedule({ weeklyHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => [day, [{ start: event.target.value, end }]])) });
              }} /></Field>
              <Field label="Weekday closing time"><input type="time" value={schedule.weeklyHours.monday?.[0]?.end || ""} onChange={(event) => {
                const start = schedule.weeklyHours.monday?.[0]?.start || "09:00";
                updateSchedule({ weeklyHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => [day, [{ start, end: event.target.value }]])) });
              }} /></Field>
              <Field label="Minimum booking notice (minutes)"><input type="number" min="0" value={schedule.minimumNoticeMinutes} onChange={(event) => updateSchedule({ minimumNoticeMinutes: Number(event.target.value) })} /></Field>
              <Field label="Buffer before (minutes)"><input type="number" min="0" value={schedule.bufferBeforeMinutes} onChange={(event) => updateSchedule({ bufferBeforeMinutes: Number(event.target.value) })} /></Field>
              <Field label="Buffer after (minutes)"><input type="number" min="0" value={schedule.bufferAfterMinutes} onChange={(event) => updateSchedule({ bufferAfterMinutes: Number(event.target.value) })} /></Field>
              <Field label="Unavailable date override"><div className="form-actions"><input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} /><Button type="button" variant="secondary" disabled={!overrideDate} onClick={() => { updateSchedule({ overrides: [...schedule.overrides.filter((item) => item.date !== overrideDate), { date: overrideDate, available: false }] }); setOverrideDate(""); }}>Add date</Button></div></Field>
              <label><input type="checkbox" checked={schedule.cancellationAllowed} onChange={(event) => updateSchedule({ cancellationAllowed: event.target.checked })} /> Customers may cancel</label>
              <label><input type="checkbox" checked={schedule.rescheduleAllowed} onChange={(event) => updateSchedule({ rescheduleAllowed: event.target.checked })} /> Customers may reschedule</label>
            </div>
            {schedule.overrides.length > 0 && <p className="muted">Unavailable: {schedule.overrides.filter((item) => !item.available).map((item) => item.date).join(", ")}</p>}
            <p className="muted">Service names and durations above become idempotent Cal.com event types during provisioning. Connect or create the account from <Link to="/app/integrations">Integrations</Link>.</p>
          </div>}

          {active.id === "review" && <div className="onboarding-review">
            <div className={`onboarding-readiness ${readiness.ready ? "ready" : ""}`}>
              <ShieldCheck />
              <div><strong>{readiness.ready ? "Your brief is ready" : `${readiness.blockers.length} item${readiness.blockers.length === 1 ? "" : "s"} to finish`}</strong>
              <p>{readiness.ready ? "Submitting starts assisted setup; it does not activate a phone number or receptionist." : "Open each item below to complete it."}</p></div>
            </div>
            {readiness.blockers.map((blocker) => <button type="button" className="onboarding-blocker" key={blocker.key} onClick={() => save.mutate({ currentStep: blocker.step })}><span>{blocker.step}</span>{blocker.message}<ChevronRight size={16} /></button>)}
            <div className="onboarding-lifecycle">
              {["Brief submitted", "Specialist configures", "Test call together", "You approve activation"].map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong></div>)}
            </div>
            {submit.error && <div className="form-alert" role="alert">{submit.error.message}</div>}
            <Button type="button" disabled={!readiness.ready || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? "Sending brief…" : "Submit for specialist setup"}
            </Button>
          </div>}

          {save.error && <div className="form-alert" role="alert">{save.error.message}</div>}
          {active.id !== "facts" && active.id !== "review" && <div className="onboarding-actions">
            <Button type="button" variant="secondary" disabled={stepIndex === 0 || save.isPending} onClick={() => go(-1)}><ChevronLeft size={16} /> Back</Button>
            <Button type="button" disabled={save.isPending || (active.id === "website" && !wizard.completedSteps.includes("website"))} onClick={() => go(1)}>
              {save.isPending ? "Saving…" : "Save and continue"} <ChevronRight size={16} />
            </Button>
          </div>}
        </section>
      </div>
    </main>
  );
}
