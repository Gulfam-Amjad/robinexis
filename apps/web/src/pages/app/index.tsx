import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Cloud,
  Code2,
  Copy,
  Database,
  FileText,
  Headphones,
  KeyRound,
  Link2,
  Mail,
  MessageCircleMore,
  MoreHorizontal,
  Phone,
  PhoneCall,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UploadCloud,
  UserPlus,
  Users,
  WandSparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";
import type { Call, Client, Job, TimeseriesPoint } from "@robinexis/api-contracts";
import { api, formatDate } from "../../lib/api";
import { useClient, useToast } from "../../state";
import { ReceptionistCall } from "../../components/ReceptionistCall";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingState,
  MetricCard,
  PageHeader,
  SectionHeading,
  SkeletonRows,
  statusTone,
} from "../../components/ui";

function ClientGate({ children }: { children: (clientId: string) => React.ReactNode }) {
  const { activeClientId, isLoading, error } = useClient();
  if (isLoading) return <LoadingState label="Loading client workspace…" />;
  if (error) return <ErrorState error={error} />;
  if (!activeClientId) {
    return <EmptyState icon={Sparkles} title="Create your first client" description="Add the business details your voice agent will use, then test and publish it." action={<LinkButton to="/app/onboarding">Start setup</LinkButton>} />;
  }
  return <>{children(activeClientId)}</>;
}

function CallTable({ calls, compact = false }: { calls: Call[]; compact?: boolean }) {
  if (!calls.length) return <EmptyState icon={PhoneCall} title="No calls yet" description="Calls will appear here as soon as your agent starts speaking with customers." action={<LinkButton to="/app/playground" variant="secondary">Test the agent</LinkButton>} />;
  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Voice call activity</caption>
        <thead><tr><th scope="col">Caller</th><th scope="col">Direction</th><th scope="col">Outcome</th>{!compact && <th scope="col">Status</th>}<th scope="col">Started</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{calls.map((call) => (
          <tr key={call.id}>
            <td><div className="table-person"><span><Phone size={15} /></span><div><strong>{call.contactPhone || "Unknown caller"}</strong><small>{call.objective || "General enquiry"}</small></div></div></td>
            <td><span className="capitalize">{call.direction}</span></td>
            <td>{call.outcome ? <Badge tone="accent">{call.outcome.replaceAll("-", " ")}</Badge> : "—"}</td>
            {!compact && <td><Badge tone={statusTone(call.status)}>{call.status}</Badge></td>}
            <td>{formatDate(call.createdAt)}</td>
            <td><Link className="row-link" to={`/app/calls/${call.id}`} aria-label="Open call"><ChevronRight size={17} /></Link></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function OverviewPage() {
  return <ClientGate>{(clientId) => <OverviewContent clientId={clientId} />}</ClientGate>;
}

function OverviewContent({ clientId }: { clientId: string }) {
  const { activeClient } = useClient();
  const bootstrap = useQuery({ queryKey: ["bootstrap", clientId], queryFn: () => api.bootstrap(clientId), retry: false });
  if (bootstrap.isLoading) return <LoadingState />;
  if (bootstrap.error) return <ErrorState error={bootstrap.error} onRetry={() => bootstrap.refetch()} />;
  const summary = bootstrap.data?.summary;
  const calls = bootstrap.data?.recentCalls || [];
  const integrations = bootstrap.data?.integrations || [];
  const integration = (id: string) => integrations.find((item) => item.id.toLowerCase() === id);
  return (
    <>
      <PageHeader eyebrow="Good afternoon" title={`${activeClient?.businessName || "Your business"} is in good hands`} description="Here’s what your receptionist has been doing for your customers." actions={<LinkButton to="/app/playground" variant="secondary"><Play size={15} /> Test agent</LinkButton>} />
      {!activeClient?.published && <div className="notice"><div><WandSparkles /><span><strong>Your agent is still a draft.</strong> Finish setup and publish before routing live calls.</span></div><Link to="/app/agents">Review agent <ChevronRight size={15} /></Link></div>}
      <div className="metrics-grid">
        <MetricCard label="Total calls" value={summary?.totalCalls ?? 0} detail="Current period" icon={PhoneCall} tone="cream" />
        <MetricCard label="Appointments booked" value={summary?.bookedAppointments ?? 0} detail={`${Math.round(summary?.bookingRate || 0)}% booking rate`} icon={CalendarCheck2} tone="sage" />
        <MetricCard label="Minutes handled" value={summary?.minutesUsed ?? 0} detail="Time back for your team" icon={Clock3} tone="peach" />
        <MetricCard label="Calls transferred" value={summary?.transferredCalls ?? 0} detail="Human handoffs" icon={Users} tone="lilac" />
      </div>
      <div className="overview-grid">
        <Card className="panel">
          <SectionHeading title="Recent calls" description="The latest customer conversations" action={<Link to="/app/calls" className="subtle-link">View all <ChevronRight size={14} /></Link>} />
          <CallTable calls={calls.slice(0, 5)} compact />
        </Card>
        <Card className="panel quick-panel">
          <SectionHeading title="Agent health" description="Ready for the next call" />
          <div className="health-ring"><div><strong>{activeClient?.published ? "Live" : "Draft"}</strong><span>status</span></div></div>
          <div className="health-list">
            <span>{integration("gemini")?.connected ? <CheckCircle2 /> : <XCircle className="danger-icon" />} Business knowledge <Badge tone={integration("gemini")?.connected ? "success" : "warning"}>{integration("gemini")?.connected ? "Ready" : "Needs setup"}</Badge></span>
            <span>{integration("calcom")?.connected ? <CheckCircle2 /> : <XCircle className="danger-icon" />} Calendar connection <Badge tone={integration("calcom")?.connected ? "success" : "warning"}>{integration("calcom")?.connected ? "Ready" : "Needs setup"}</Badge></span>
            <span>{activeClient?.published ? <CheckCircle2 /> : <Clock3 />} Published prompt <Badge tone={activeClient?.published ? "success" : "warning"}>{activeClient?.published ? "Ready" : "Needs review"}</Badge></span>
          </div>
          <Link className="button button-secondary button-md full-button" to="/app/agents">Manage agent <Settings2 size={15} /></Link>
        </Card>
      </div>
    </>
  );
}

const clientSchema = z.object({
  businessName: z.string().min(2, "Business name is required"),
  slug: z.string().min(2, "Use at least 2 characters").regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens"),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Enter a valid email").or(z.literal("")),
  calendarProvider: z.enum(["calcom", "google", "outlook", "fresha"]),
});

export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { setActiveClientId } = useClient();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: { calendarProvider: "calcom" },
  });
  const create = useMutation({
    mutationFn: (values: z.infer<typeof clientSchema>) => api.createClient({
      businessName: values.businessName,
      slug: values.slug,
      location: values.location,
      phone: values.phone,
      email: values.email,
      calendar: { provider: values.calendarProvider },
      role: "AI receptionist",
      tone: "Warm, professional and concise",
      publishedFacts: [],
      unknownTopics: [],
      services: [],
    }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      setActiveClientId(created.id);
      push({ title: "Workspace created", message: "Now shape your first voice agent.", tone: "success" });
      navigate("/app/agents/new");
    },
    onError: (error) => push({ title: "Couldn’t create client", message: error.message, tone: "error" }),
  });
  return (
    <div className="onboarding-page">
      <PageHeader eyebrow="Client setup" title="Let’s learn the essentials" description="Start with the details your receptionist needs to identify the business. You can refine everything later." />
      <div className="onboarding-layout">
        <div className="setup-steps"><span className="done"><Check />Business</span><i /><span>2 Agent</span><i /><span>3 Test</span><i /><span>4 Publish</span></div>
        <Card className="form-card">
          <div className="form-card-head"><div className="feature-icon"><Sparkles /></div><div><h2>About the business</h2><p>Only add information you’re comfortable letting the agent use.</p></div></div>
          <form onSubmit={handleSubmit((values) => create.mutate(values))}>
            <div className="form-grid">
              <Field label="Business name" error={errors.businessName?.message}><input placeholder="Flourish Salon" {...register("businessName")} /></Field>
              <Field label="Workspace slug" error={errors.slug?.message}><input placeholder="flourish-salon" {...register("slug")} /></Field>
              <Field label="Location"><input placeholder="Leeds, UK" {...register("location")} /></Field>
              <Field label="Business phone"><input placeholder="+44 113 000 0000" {...register("phone")} /></Field>
              <Field label="Customer email" error={errors.email?.message}><input placeholder="hello@business.co.uk" {...register("email")} /></Field>
              <Field label="Calendar provider"><select {...register("calendarProvider")}><option value="calcom">Cal.com</option><option value="google">Google Calendar</option><option value="outlook">Outlook</option><option value="fresha">Fresha</option></select></Field>
            </div>
            <div className="form-actions"><Link className="button button-ghost button-md" to="/app">Cancel</Link><Button disabled={create.isPending}>{create.isPending ? "Creating…" : "Continue to agent"} <ChevronRight size={16} /></Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function AgentsPage() {
  return <ClientGate>{(clientId) => <AgentsContent clientId={clientId} />}</ClientGate>;
}

function AgentsContent({ clientId }: { clientId: string }) {
  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId), retry: false });
  if (client.isLoading) return <LoadingState label="Loading your agent…" />;
  if (client.error) return <ErrorState error={client.error} onRetry={() => client.refetch()} />;
  const item = client.data!;
  return (
    <>
      <PageHeader eyebrow="Voice agents" title="Your reception team" description="Configure how Robinexis answers, acts, and hands conversations back to people." actions={<LinkButton to="/app/agents/new"><Plus size={15} /> New agent</LinkButton>} />
      <div className="agent-grid">
        <Card className="agent-card">
          <div className="agent-card-top"><span className="agent-avatar"><Bot /></span><Badge tone={item.published ? "success" : "warning"}>{item.published ? "Live" : "Draft"}</Badge></div>
          <h2>{item.role || `${item.businessName} Receptionist`}</h2><p>{item.tone || "Warm, confident and naturally helpful"}</p>
          <div className="agent-meta"><span><PhoneCall /> {item.inboundNumbers?.length || 0} number{item.inboundNumbers?.length === 1 ? "" : "s"}</span><span><BookOpen /> {item.publishedFacts?.length || 0} facts</span></div>
          <div className="agent-card-actions"><Link className="button button-secondary button-md" to={`/app/agents/${item.id}`}>Open agent</Link><Link className="icon-button" to="/app/playground"><Play size={17} /></Link></div>
        </Card>
        <button className="new-agent-card" onClick={() => { window.location.href = "/app/agents/new"; }}><span><Plus /></span><strong>Create another agent</strong><p>Set up a different role, location, or conversation flow.</p></button>
      </div>
    </>
  );
}

const agentSchema = z.object({
  role: z.string().min(3, "Give your agent a role"),
  tone: z.string().min(3, "Describe how it should sound"),
  voiceId: z.string().optional(),
  transferNumber: z.string().optional(),
  greeting: z.string().min(8, "Write a short opening"),
  facts: z.string().optional(),
  unknowns: z.string().optional(),
  services: z.string().optional(),
  staff: z.string().optional(),
  hours: z.string().optional(),
  prices: z.string().optional(),
  policies: z.string().optional(),
  inboundNumbers: z.string().optional(),
});

function AgentForm({ client, isNew = false }: { client: Client; isNew?: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<z.infer<typeof agentSchema>>({
    resolver: zodResolver(agentSchema),
    defaultValues: {
      role: client.role || `${client.businessName} AI receptionist`,
      tone: client.tone || "Warm, professional and concise",
      voiceId: client.voiceId || "",
      transferNumber: client.transferNumber || "",
      greeting: client.greeting || `Hello, you've reached ${client.businessName}. How can I help today?`,
      facts: (client.publishedFacts || []).join("\n"),
      unknowns: (client.unknownTopics || []).join("\n"),
      services: (client.services || []).map((service) => `${service.title} | ${service.slug} | ${service.durationMinutes}`).join("\n"),
      staff: (client.staff || []).join("\n"),
      hours: client.hours || "",
      prices: client.prices || "",
      policies: (client.policies || []).join("\n"),
      inboundNumbers: (client.inboundNumbers || []).join("\n"),
    },
  });
  const save = useMutation({
    mutationFn: (values: z.infer<typeof agentSchema>) => api.updateClient(client.id, {
      role: values.role,
      tone: values.tone,
      voiceId: values.voiceId,
      transferNumber: values.transferNumber,
      greeting: values.greeting,
      publishedFacts: values.facts?.split("\n").map((value) => value.trim()).filter(Boolean),
      unknownTopics: values.unknowns?.split("\n").map((value) => value.trim()).filter(Boolean),
      services: values.services?.split("\n").map((line) => {
        const [title, slug, duration] = line.split("|").map((value) => value.trim());
        return { title, slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), durationMinutes: Number(duration || 30) };
      }).filter((service) => service.title),
      staff: values.staff?.split("\n").map((value) => value.trim()).filter(Boolean),
      hours: values.hours,
      prices: values.prices,
      policies: values.policies?.split("\n").map((value) => value.trim()).filter(Boolean),
      inboundNumbers: values.inboundNumbers?.split("\n").map((value) => value.trim()).filter(Boolean),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client", client.id] });
      push({ title: "Agent saved", message: "Changes are ready to test. Publish when you’re happy.", tone: "success" });
      if (isNew) navigate(`/app/agents/${client.id}`);
    },
    onError: (error) => push({ title: "Save failed", message: error.message, tone: "error" }),
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  return (
    <form className="agent-editor" onSubmit={handleSubmit((values) => save.mutate(values))}>
      <Card className="form-card">
        <SectionHeading title="Personality & voice" description="Make the agent sound like a natural extension of the team." />
        <div className="form-grid">
          <Field label="Role" error={errors.role?.message}><input {...register("role")} /></Field>
          <Field label="Tone" error={errors.tone?.message}><input {...register("tone")} /></Field>
          <Field label="ElevenLabs voice ID" hint="Leave empty to use the workspace default."><input placeholder="Optional voice ID" {...register("voiceId")} /></Field>
          <Field label="Human transfer number"><input placeholder="+44…" {...register("transferNumber")} /></Field>
        </div>
        <Field label="Opening greeting" error={errors.greeting?.message}><textarea rows={3} {...register("greeting")} /></Field>
      </Card>
      <Card className="form-card">
        <SectionHeading title="Approved knowledge" description="One fact per line. The agent is instructed never to invent anything outside these facts." />
        <Field label="Published facts" hint="Examples: We are open Tuesday–Saturday. · Parking is available behind the building."><textarea rows={7} placeholder="Add approved facts…" {...register("facts")} /></Field>
        <Field label="Topics that need a human" hint="The agent will offer a handoff instead of guessing."><textarea rows={4} placeholder="Complex pricing&#10;Complaints&#10;Specialist availability" {...register("unknowns")} /></Field>
      </Card>
      <Card className="form-card">
        <SectionHeading title="Services & operations" description="These fields control what the agent can offer and how calls are routed." />
        <Field label="Services" hint="One per line: Title | slug | duration minutes"><textarea rows={5} placeholder="Haircut & Style | haircut-style | 45" {...register("services")} /></Field>
        <div className="form-grid">
          <Field label="Team members" hint="One name per line"><textarea rows={4} {...register("staff")} /></Field>
          <Field label="Inbound phone numbers" hint="One E.164 number per line"><textarea rows={4} placeholder="+447700900000" {...register("inboundNumbers")} /></Field>
          <Field label="Opening hours"><textarea rows={4} {...register("hours")} /></Field>
          <Field label="Prices"><textarea rows={4} {...register("prices")} /></Field>
        </div>
        <Field label="Policies" hint="One approved policy per line"><textarea rows={5} {...register("policies")} /></Field>
      </Card>
      <div className="sticky-save"><span>{isDirty ? "You have unpublished changes" : "All changes saved"}</span><Button disabled={save.isPending}>{save.isPending ? "Saving…" : "Save agent"} <Check size={16} /></Button></div>
    </form>
  );
}

export function NewAgentPage() {
  const { activeClientId } = useClient();
  const client = useQuery({ queryKey: ["client", activeClientId], queryFn: () => api.client(activeClientId!), enabled: Boolean(activeClientId), retry: false });
  if (!activeClientId) return <EmptyState icon={Bot} title="Create a client first" description="Agents belong to a client workspace." action={<LinkButton to="/app/onboarding">Start setup</LinkButton>} />;
  if (client.isLoading) return <LoadingState />;
  if (client.error) return <ErrorState error={client.error} />;
  return <><PageHeader eyebrow="New voice agent" title="Shape the conversation" description="Start with a clear role, safe knowledge, and a warm opening." /><AgentForm client={client.data!} isNew /></>;
}

export function AgentDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const client = useQuery({ queryKey: ["client", id], queryFn: () => api.client(id!), enabled: Boolean(id), retry: false });
  const versions = useQuery({ queryKey: ["promptVersions", id], queryFn: () => api.promptVersions(id!), enabled: Boolean(id), retry: false });
  const publish = useMutation({
    mutationFn: () => api.publishClient(id!),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["client", id] }), queryClient.invalidateQueries({ queryKey: ["clients"] }), queryClient.invalidateQueries({ queryKey: ["promptVersions", id] })]);
      push({ title: "Agent published", message: "New calls will use the latest approved prompt.", tone: "success" });
    },
    onError: (error) => push({ title: "Publish failed", message: error.message, tone: "error" }),
  });
  if (client.isLoading) return <LoadingState />;
  if (client.error) return <ErrorState error={client.error} onRetry={() => client.refetch()} />;
  return (
    <>
      <Link className="back-link" to="/app/agents"><ArrowLeft size={15} /> All agents</Link>
      <PageHeader eyebrow="Agent editor" title={client.data?.role || "Voice receptionist"} description={`${client.data?.businessName} · ${client.data?.tone || "Warm and professional"}`} actions={<><Link className="button button-secondary button-md" to="/app/playground"><Play size={15} /> Test</Link><Button onClick={() => publish.mutate()} disabled={publish.isPending}>{publish.isPending ? "Publishing…" : "Publish"} <UploadCloud size={15} /></Button></>} />
      <div className="editor-layout">
        <div><AgentForm client={client.data!} /></div>
        <aside className="editor-aside">
          <Card className="panel"><SectionHeading title="Publish status" /><div className="publish-status"><span className={client.data?.published ? "status-orb live" : "status-orb"}><Cloud /></span><div><strong>{client.data?.published ? "Live" : "Draft changes"}</strong><p>{client.data?.published ? "Calls use the latest version." : "Publish before live calls can answer."}</p></div></div></Card>
          <Card className="panel"><SectionHeading title="Prompt history" />{versions.isLoading ? <SkeletonRows count={3} /> : versions.data?.length ? <div className="version-list">{versions.data.slice(0, 5).map((version) => <span key={version.id}><i>v{version.version}</i><div><strong>Published prompt</strong><small>{formatDate(version.createdAt)}</small></div></span>)}</div> : <p className="muted">No published versions yet.</p>}</Card>
          <Card className="safety-card"><ShieldCheck /><h3>Built-in safety</h3><p>Agent prompts are frozen per call. Updating settings never changes a conversation already in progress.</p></Card>
        </aside>
      </div>
    </>
  );
}

export function PlaygroundPage() {
  return (
    <>
      <PageHeader
        eyebrow="Agent playground"
        title="Your receptionist, ready to talk"
        description="Test the same Sophie experience your callers hear, without leaving Robinexis."
        actions={<Link className="button button-secondary button-md" to="/demo/blades-hair" target="_blank">Open public demo <Link2 size={15} /></Link>}
      />
      <ReceptionistCall compact />
    </>
  );
}

export function CallsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  return <ClientGate>{(clientId) => <CallsContent clientId={clientId} search={search} status={status} setSearch={setSearch} setStatus={setStatus} />}</ClientGate>;
}

function CallsContent({ clientId, search, status, setSearch, setStatus }: { clientId: string; search: string; status: string; setSearch: (value: string) => void; setStatus: (value: string) => void }) {
  const calls = useQuery({ queryKey: ["calls", clientId, status, search], queryFn: () => api.calls(clientId, { status, search }), retry: false });
  return (
    <>
      <PageHeader eyebrow="Call activity" title="Every conversation, accounted for" description="Review outcomes, transcripts, handoffs, and the actions your agent took." />
      <Card className="panel">
        <div className="filter-bar"><label className="search-field"><span className="sr-only">Search calls</span><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search callers or outcomes…" /></label><label className="filter-control"><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="completed">Completed</option><option value="active">Active</option><option value="transferred">Transferred</option><option value="failed">Failed</option></select></label></div>
        {calls.isLoading ? <SkeletonRows count={6} /> : calls.error ? <ErrorState error={calls.error} onRetry={() => calls.refetch()} /> : !calls.data?.length && (search || status) ? <EmptyState icon={Search} title="No matching calls" description="Try a broader search or clear the status filter." action={<Button variant="secondary" onClick={() => { setSearch(""); setStatus(""); }}>Clear filters</Button>} /> : <CallTable calls={calls.data || []} />}
      </Card>
    </>
  );
}

export function CallDetailPage() {
  const { id } = useParams();
  const { activeClientId } = useClient();
  const call = useQuery({ queryKey: ["call", id, activeClientId], queryFn: () => api.call(id!, activeClientId!), enabled: Boolean(id && activeClientId), retry: false });
  if (call.isLoading) return <LoadingState label="Loading conversation…" />;
  if (call.error) return <ErrorState error={call.error} onRetry={() => call.refetch()} />;
  if (!call.data) return <EmptyState title="Call not found" description="This call may have been removed by the retention policy." />;
  const item = call.data;
  return (
    <>
      <Link className="back-link" to="/app/calls"><ArrowLeft size={15} /> All calls</Link>
      <PageHeader eyebrow={`Call ${item.id.slice(0, 8)}`} title={item.contactPhone || "Unknown caller"} description={`${formatDate(item.createdAt)} · ${item.direction} call`} actions={<Badge tone={statusTone(item.status)}>{item.status}</Badge>} />
      <div className="call-detail-grid">
        <Card className="panel transcript-panel"><SectionHeading title="Transcript" description="Sensitive payment and identity data is redacted before storage." />{item.transcript?.length ? <div className="transcript">{item.transcript.map((turn, index) => <div className={`turn turn-${turn.role}`} key={`${turn.at}-${index}`}><span>{turn.role === "agent" ? <Sparkles /> : turn.role === "caller" ? <Phone /> : <Code2 />}</span><div><strong>{turn.role}</strong><p>{turn.text}</p><small>{formatDate(turn.at, { timeStyle: "short" })}</small></div></div>)}</div> : <EmptyState icon={MessageCircleMore} title="No transcript available" description="The call may have ended before speech was captured." />}</Card>
        <aside className="call-aside">
          <Card className="panel"><SectionHeading title="Call details" /><dl className="detail-list"><div><dt>Direction</dt><dd className="capitalize">{item.direction}</dd></div><div><dt>Outcome</dt><dd>{item.outcome?.replaceAll("-", " ") || "Not set"}</dd></div><div><dt>Objective</dt><dd>{item.objective || "General enquiry"}</dd></div><div><dt>Started</dt><dd>{formatDate(item.createdAt)}</dd></div></dl></Card>
          <Card className="panel"><SectionHeading title="Actions taken" />{item.toolHistory?.length ? <div className="tool-list">{item.toolHistory.map((tool, index) => <div key={`${tool.at}-${index}`}><span className={tool.error ? "tool-fail" : "tool-pass"}>{tool.error ? <XCircle /> : <Check />}</span><div><strong>{tool.name.replaceAll("_", " ")}</strong><small>{tool.error || formatDate(tool.at)}</small></div></div>)}</div> : <p className="muted">No tools were used during this call.</p>}</Card>
        </aside>
      </div>
    </>
  );
}

const fallbackSeries: TimeseriesPoint[] = Array.from({ length: 14 }, (_, index) => ({ date: new Date(Date.now() - (13 - index) * 86400000).toISOString().slice(0, 10), calls: 0, bookings: 0, minutes: 0 }));

export function AnalyticsPage() {
  return <ClientGate>{(clientId) => <AnalyticsContent clientId={clientId} />}</ClientGate>;
}

function AnalyticsContent({ clientId }: { clientId: string }) {
  const [period, setPeriod] = useState("30");
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(period) * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [period]);
  const summary = useQuery({ queryKey: ["analytics-summary", clientId, period], queryFn: () => api.analyticsSummary(clientId, range), retry: false });
  const series = useQuery({ queryKey: ["analytics-timeseries", clientId, period], queryFn: () => api.analyticsTimeseries(clientId, range), retry: false });
  if (summary.isLoading || series.isLoading) return <LoadingState label="Building your report…" />;
  if (summary.error || series.error) return <ErrorState error={summary.error || series.error} onRetry={() => { summary.refetch(); series.refetch(); }} />;
  const data = series.data?.length ? series.data : fallbackSeries;
  const outcomeData = [
    { name: "Booked", value: summary.data?.bookedAppointments || 0, color: "#d56f4a" },
    { name: "Transferred", value: summary.data?.transferredCalls || 0, color: "#8da58e" },
    { name: "Other", value: Math.max(0, (summary.data?.totalCalls || 0) - (summary.data?.bookedAppointments || 0) - (summary.data?.transferredCalls || 0)), color: "#ddd3c5" },
  ];
  return (
    <>
      <PageHeader eyebrow="Performance" title="Know what’s happening on the phone" description="Measure demand, appointment outcomes, and how much time Robinexis gives back." actions={<label><span className="sr-only">Reporting period</span><select className="period-select" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="90">Last 90 days</option></select></label>} />
      <div className="metrics-grid"><MetricCard label="Calls answered" value={summary.data?.answeredCalls ?? 0} icon={PhoneCall} detail="Handled by Robinexis" /><MetricCard label="Booking rate" value={`${Math.round(summary.data?.bookingRate || 0)}%`} icon={TrendingUp} detail="Of eligible calls" tone="sage" /><MetricCard label="Appointments" value={summary.data?.bookedAppointments ?? 0} icon={CalendarCheck2} detail="Successfully booked" tone="peach" /><MetricCard label="Minutes saved" value={summary.data?.minutesUsed ?? 0} icon={Clock3} detail="Customer talk time" tone="lilac" /></div>
      <div className="analytics-grid">
        <Card className="panel chart-card"><SectionHeading title="Calls & bookings" description="Daily activity across the selected period" /><div className="chart-wrap" role="img" aria-label={`${summary.data?.totalCalls || 0} calls and ${summary.data?.bookedAppointments || 0} bookings in the selected period`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id="calls" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#d56f4a" stopOpacity={0.35}/><stop offset="95%" stopColor="#d56f4a" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#ebe4da" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip /><Area type="monotone" dataKey="calls" stroke="#d56f4a" fill="url(#calls)" strokeWidth={2.5} /><Area type="monotone" dataKey="bookings" stroke="#617a65" fill="transparent" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></Card>
        <Card className="panel outcome-card"><SectionHeading title="Call outcomes" description="What callers achieved" /><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={outcomeData} innerRadius={58} outerRadius={80} dataKey="value" paddingAngle={3}>{outcomeData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{summary.data?.totalCalls || 0}</strong><span>calls</span></div></div><div className="chart-legend">{outcomeData.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}<strong>{item.value}</strong></span>)}</div></Card>
      </div>
    </>
  );
}

export function CalendarPage() {
  return <ClientGate>{(clientId) => <CalendarContent clientId={clientId} />}</ClientGate>;
}

function CalendarContent({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [eventSlug, setEventSlug] = useState("15min");
  const [cancelUid, setCancelUid] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{ uid: string; start: string } | null>(null);
  const bookings = useQuery({ queryKey: ["bookings", clientId], queryFn: () => api.bookings(clientId), retry: false });
  const slots = useQuery({ queryKey: ["slots", clientId, eventSlug], queryFn: () => api.slots(clientId, eventSlug), retry: false });
  const calendarAction = useMutation({
    mutationFn: async ({ uid, action, newStart }: { uid: string; action: "reschedule" | "cancel"; newStart?: string }) => {
      if (action === "cancel") {
        await api.cancelBooking(uid, clientId);
        return;
      }
      if (!newStart) return;
      await api.rescheduleBooking(uid, clientId, newStart);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bookings", clientId] });
      push({ title: "Calendar updated", tone: "success" });
    },
    onError: (error) => push({ title: "Calendar update failed", message: error.message, tone: "error" }),
  });
  const grouped = useMemo(() => {
    const result = new Map<string, NonNullable<typeof bookings.data>>();
    for (const booking of bookings.data || []) {
      const day = new Date(booking.start).toISOString().slice(0, 10);
      result.set(day, [...(result.get(day) || []), booking]);
    }
    return [...result.entries()];
  }, [bookings.data]);
  return (
    <>
      <PageHeader eyebrow="Calendar" title="Appointments in one calm view" description="Review bookings made through conversations and keep an eye on upcoming demand." actions={<Link className="button button-secondary button-md" to="/app/integrations"><Link2 size={15} /> Calendar settings</Link>} />
      <div className="calendar-summary"><Card><CalendarCheck2 /><div><strong>{bookings.data?.length || 0}</strong><span>Upcoming bookings</span></div></Card><Card><Clock3 /><div><strong>Live</strong><span>Availability sync</span></div></Card><Card><Sparkles /><div><strong>AI</strong><span>Booking source</span></div></Card></div>
      <Card className="panel"><SectionHeading title="Live availability" description="Read-only slots returned by the connected calendar." /><div className="form-grid"><Field label="Event type slug"><input value={eventSlug} onChange={(event) => setEventSlug(event.target.value)} placeholder="15min" /></Field><div className="form-actions"><Button variant="secondary" onClick={() => slots.refetch()} disabled={!eventSlug || slots.isFetching}><RefreshCw size={15} /> {slots.isFetching ? "Checking…" : "Refresh slots"}</Button></div></div>{slots.error ? <ErrorState error={slots.error} /> : <div className="slot-grid">{(slots.data || []).slice(0, 8).map((slot) => <span key={slot.start}>{formatDate(slot.start)}</span>)}{!slots.isLoading && !slots.data?.length && <p className="muted">No slots returned for this event type.</p>}</div>}</Card>
      <Card className="panel">
        <SectionHeading title="Upcoming appointments" description="Times shown in your workspace timezone" />
        {bookings.isLoading ? <SkeletonRows count={5} /> : bookings.error ? <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} /> : !grouped.length ? <EmptyState icon={CalendarDays} title="No appointments yet" description="Connect a calendar and add service event types so your agent can offer real availability." action={<LinkButton to="/app/integrations" variant="secondary">Connect calendar</LinkButton>} /> : <div className="agenda">{grouped.map(([day, items]) => <div className="agenda-day" key={day}><div className="agenda-date"><strong>{new Date(day).toLocaleDateString("en-GB", { day: "2-digit" })}</strong><span>{new Date(day).toLocaleDateString("en-GB", { month: "short", weekday: "short" })}</span></div><div>{items.map((booking) => <div className="booking-row" key={booking.uid}><span className="booking-time">{new Date(booking.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span><i /><div><strong>{booking.attendeeName || booking.title || "Customer appointment"}</strong><small>{booking.attendeeEmail || "Booked by voice agent"}</small></div><Badge tone={statusTone(booking.status || "active")}>{booking.status || "confirmed"}</Badge><div className="row-actions"><Button size="sm" variant="ghost" disabled={calendarAction.isPending} onClick={() => setRescheduleTarget({ uid: booking.uid, start: booking.start })}>Move</Button><button aria-label="Cancel appointment" className="icon-button danger-icon" disabled={calendarAction.isPending} onClick={() => setCancelUid(booking.uid)}><XCircle size={17} /></button></div></div>)}</div></div>)}</div>}
      </Card>
      <ConfirmDialog open={Boolean(cancelUid)} title="Cancel this appointment?" description="This updates the connected live calendar immediately and cannot be undone from Robinexis." confirmLabel="Cancel appointment" busy={calendarAction.isPending} onClose={() => setCancelUid(null)} onConfirm={() => { if (cancelUid) calendarAction.mutate({ uid: cancelUid, action: "cancel" }, { onSuccess: () => setCancelUid(null) }); }} />
      <RescheduleDialog target={rescheduleTarget} busy={calendarAction.isPending} onClose={() => setRescheduleTarget(null)} onConfirm={(newStart) => { if (rescheduleTarget) calendarAction.mutate({ uid: rescheduleTarget.uid, action: "reschedule", newStart }, { onSuccess: () => setRescheduleTarget(null) }); }} />
    </>
  );
}

function RescheduleDialog({ target, busy, onClose, onConfirm }: { target: { uid: string; start: string } | null; busy: boolean; onClose: () => void; onConfirm: (start: string) => void }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue(target ? new Date(target.start).toISOString().slice(0, 16) : "");
  }, [target]);
  if (!target) return null;
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="move-title"><h2 id="move-title">Move appointment</h2><p>Choose the new confirmed start time. This updates the live calendar.</p><Field label="New start time"><input type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>Keep current time</Button><Button type="button" disabled={!value || busy} onClick={() => onConfirm(new Date(value).toISOString())}>{busy ? "Moving…" : "Confirm new time"}</Button></div></section></div>;
}

const jobSchema = z.object({
  campaign: z.enum(["appointment-reminder", "rebooking", "missed-callback", "waitlist-slot", "disruption-reschedule"]),
  contactPhone: z.string().min(8, "Enter a phone number"),
  contactName: z.string().optional(),
  purpose: z.string().min(4, "Add a clear call purpose"),
  scheduledAt: z.string().min(1, "Choose a time"),
});

export function CampaignsPage() {
  return <ClientGate>{(clientId) => <CampaignsContent clientId={clientId} />}</ClientGate>;
}

function CampaignsContent({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [approval, setApproval] = useState<{ id: string; name: string } | null>(null);
  const [cancelJob, setCancelJob] = useState<string | null>(null);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs", clientId], queryFn: () => api.jobs(clientId), retry: false });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof jobSchema>>({ resolver: zodResolver(jobSchema), defaultValues: { campaign: "appointment-reminder" } });
  const create = useMutation({
    mutationFn: (values: z.infer<typeof jobSchema>) => api.createJob({ ...values, clientId, approved: false, attemptCount: 0, maxAttempts: 3, status: "pending" }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["jobs", clientId] }); reset(); setOpen(false); push({ title: "Outbound job created", message: "Approve it when you’re ready for the worker to dial.", tone: "success" }); },
    onError: (error) => push({ title: "Couldn’t create job", message: error.message, tone: "error" }),
  });
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "approve" | "cancel" }) => api.jobAction(id, type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs", clientId] }),
    onError: (error) => push({ title: "Action failed", message: error.message, tone: "error" }),
  });
  return (
    <>
      <PageHeader eyebrow="Outbound campaigns" title="Thoughtful follow-up, at the right time" description="Queue reminders, callbacks and rebooking conversations with human approval built in." actions={<Button onClick={() => setOpen((value) => !value)}><Plus size={15} /> New call</Button>} />
      {open && <Card className="form-card inline-create"><SectionHeading title="Schedule an outbound call" description="The first campaign requires approval before any number is dialled." /><form onSubmit={handleSubmit((values) => create.mutate(values))}><div className="form-grid"><Field label="Campaign"><select {...register("campaign")}><option value="appointment-reminder">Appointment reminder</option><option value="rebooking">Rebooking</option><option value="missed-callback">Missed callback</option><option value="waitlist-slot">Waitlist slot</option><option value="disruption-reschedule">Disruption reschedule</option></select></Field><Field label="Contact name"><input {...register("contactName")} /></Field><Field label="Contact phone" error={errors.contactPhone?.message}><input placeholder="+44…" {...register("contactPhone")} /></Field><Field label="Schedule" error={errors.scheduledAt?.message}><input type="datetime-local" {...register("scheduledAt")} /></Field></div><Field label="Purpose" error={errors.purpose?.message}><textarea rows={2} placeholder="Remind the customer about tomorrow's appointment…" {...register("purpose")} /></Field><div className="form-actions"><Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={create.isPending}>Create job</Button></div></form></Card>}
      <div className="metrics-grid metrics-compact"><MetricCard label="Queued" value={(jobs.data || []).filter((job) => ["pending", "approved"].includes(job.status)).length} icon={Clock3} /><MetricCard label="Dialling" value={(jobs.data || []).filter((job) => job.status === "dialing").length} icon={PhoneCall} tone="peach" /><MetricCard label="Completed" value={(jobs.data || []).filter((job) => job.status === "completed").length} icon={CheckCircle2} tone="sage" /></div>
      <div className="notice"><div><ShieldCheck /><span><strong>Human approval is mandatory.</strong> Confirm consent, purpose and contact details before releasing any outbound call.</span></div></div>
      <Card className="panel">{jobs.isLoading ? <SkeletonRows count={6} /> : jobs.error ? <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} /> : !jobs.data?.length ? <EmptyState icon={Headphones} title="No outbound calls queued" description="Create a reminder or follow-up. Every first campaign stays paused until a person approves it." action={<Button onClick={() => setOpen(true)}><Plus size={15} /> Create first call</Button>} /> : <JobTable jobs={jobs.data} onAction={(id, type) => { const job = jobs.data?.find((item) => item.id === id); if (type === "approve") setApproval({ id, name: job?.contactName || job?.contactPhone || "this contact" }); else setCancelJob(id); }} />}</Card>
      <ConfirmDialog open={Boolean(approval)} tone="primary" title="Approve this outbound call?" description={`You confirm ${approval?.name || "this contact"} may be called for the stated purpose and the campaign complies with your consent policy.`} confirmLabel="Approve call" busy={action.isPending} onClose={() => setApproval(null)} onConfirm={() => { if (approval) action.mutate({ id: approval.id, type: "approve" }, { onSuccess: () => setApproval(null) }); }} />
      <ConfirmDialog open={Boolean(cancelJob)} title="Cancel this outbound job?" description="The worker will no longer attempt this call." confirmLabel="Cancel job" busy={action.isPending} onClose={() => setCancelJob(null)} onConfirm={() => { if (cancelJob) action.mutate({ id: cancelJob, type: "cancel" }, { onSuccess: () => setCancelJob(null) }); }} />
    </>
  );
}

function JobTable({ jobs, onAction }: { jobs: Job[]; onAction: (id: string, type: "approve" | "cancel") => void }) {
  return <div className="table-scroll"><table><caption className="sr-only">Outbound call jobs</caption><thead><tr><th scope="col">Contact</th><th scope="col">Campaign</th><th scope="col">Scheduled</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.contactName || job.contactPhone}</strong><small className="block">{job.contactName ? job.contactPhone : job.purpose}</small></td><td className="capitalize">{job.campaign.replaceAll("-", " ")}</td><td>{formatDate(job.scheduledAt)}</td><td><Badge tone={statusTone(job.status)}>{job.status}</Badge></td><td>{job.attemptCount}/{job.maxAttempts}</td><td><div className="row-actions">{job.status === "pending" && <Button size="sm" onClick={() => onAction(job.id, "approve")}>Approve</Button>}{!["completed", "cancelled", "failed"].includes(job.status) && <button aria-label={`Cancel job for ${job.contactName || job.contactPhone}`} className="icon-button danger-icon" onClick={() => onAction(job.id, "cancel")}><XCircle size={17} /></button>}</div></td></tr>)}</tbody></table></div>;
}

const documentSchema = z.object({ title: z.string().min(2, "Add a title"), source: z.string().optional(), content: z.string().optional() });

export function KnowledgePage() {
  return <ClientGate>{(clientId) => <KnowledgeContent clientId={clientId} />}</ClientGate>;
}

function KnowledgeContent({ clientId }: { clientId: string }) {
  const [adding, setAdding] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const documents = useQuery({ queryKey: ["documents", clientId], queryFn: () => api.documents(clientId), retry: false });
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof documentSchema>>({ resolver: zodResolver(documentSchema) });
  const create = useMutation({
    mutationFn: (values: z.infer<typeof documentSchema>) => api.createDocument({ ...values, clientId, file: sourceFile || undefined }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["documents", clientId] }); reset(); setSourceFile(null); setAdding(false); push({ title: "Knowledge added", message: "The source is indexed and ready for retrieval.", tone: "success" }); },
    onError: (error) => push({ title: "Upload failed", message: error.message, tone: "error" }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteDocument(id, clientId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["documents", clientId] }); setDeleteTarget(null); push({ title: "Knowledge source removed", tone: "success" }); }, onError: (error) => push({ title: "Delete failed", message: error.message, tone: "error" }) });
  const search = useMutation({ mutationFn: () => api.searchKnowledge(clientId, searchText), onError: (error) => push({ title: "Search failed", message: error.message, tone: "error" }) });
  return (
    <>
      <PageHeader eyebrow="Knowledge" title="Give your agent the right answers" description="Add approved sources, keep facts current, and test what the agent can retrieve." actions={<Button onClick={() => setAdding((value) => !value)}><Plus size={15} /> Add source</Button>} />
      <div className="knowledge-grid">
        <div>
          {adding && <Card className="form-card inline-create"><SectionHeading title="Add a knowledge source" description="Upload TXT, Markdown, or a text-based PDF (maximum 5 MB), or paste approved content. Never include credentials." /><form onSubmit={handleSubmit((values) => { if (!sourceFile && !values.content?.trim()) { push({ title: "Add some knowledge", message: "Choose a file or paste approved content.", tone: "error" }); return; } create.mutate(values); })}><div className="form-grid"><Field label="Title" error={errors.title?.message}><input placeholder="Services & pricing" {...register("title")} /></Field><Field label="Source label or URL" error={errors.source?.message}><input placeholder="Internal handbook" {...register("source")} /></Field></div><Field label="Upload source"><input type="file" accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => { const file = event.target.files?.[0] || null; if (file && file.size > 5 * 1024 * 1024) { push({ title: "File is too large", message: "Knowledge files are limited to 5 MB.", tone: "error" }); event.target.value = ""; setSourceFile(null); return; } setSourceFile(file); }} /></Field><Field label="Or paste content"><textarea rows={6} placeholder="Paste approved knowledge…" {...register("content")} /></Field><div className="form-actions"><Button variant="ghost" type="button" onClick={() => { setAdding(false); setSourceFile(null); }}>Cancel</Button><Button disabled={create.isPending}>{create.isPending ? "Indexing…" : "Add & index"}</Button></div></form></Card>}
          <Card className="panel"><SectionHeading title="Sources" description={`${documents.data?.length || 0} document${documents.data?.length === 1 ? "" : "s"} available to your agent`} />{documents.isLoading ? <SkeletonRows count={5} /> : documents.error ? <ErrorState error={documents.error} onRetry={() => documents.refetch()} /> : !documents.data?.length ? <EmptyState icon={BookOpen} title="Your knowledge base is empty" description="Add a website page, service guide, or approved FAQ so your agent can answer with confidence." action={<Button onClick={() => setAdding(true)}><Plus size={15} /> Add first source</Button>} /> : <div className="document-list">{documents.data.map((document) => <div key={document.id}><span className="document-icon"><FileText /></span><div><strong>{document.title}</strong><small>{document.source || "Manual content"} · {document.chunkCount || 0} sections</small></div><Badge tone={statusTone(document.status)}>{document.status || "ready"}</Badge><button aria-label={`Delete ${document.title}`} className="icon-button danger-icon" onClick={() => setDeleteTarget({ id: document.id, title: document.title })}><Trash2 size={16} /></button></div>)}</div>}</Card>
        </div>
        <aside><Card className="panel knowledge-test"><SectionHeading title="Test retrieval" description="Ask a factual question and inspect the matching source text." /><label className="search-field"><Search /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="What services do we offer?" /></label><Button className="full-button" disabled={!searchText || search.isPending} onClick={() => search.mutate()}>{search.isPending ? "Searching…" : "Search knowledge"} <Send size={15} /></Button>{search.data && <div className="search-results">{search.data.results.length ? search.data.results.map((result, index) => <div key={index}><Badge tone="accent">{Math.round((result.score || 0) * 100)}% match</Badge><p>{result.text}</p></div>) : <p className="muted">No matching knowledge found.</p>}</div>}</Card></aside>
      </div>
      <ConfirmDialog open={Boolean(deleteTarget)} title="Delete this knowledge source?" description={`“${deleteTarget?.title || "This source"}” and its indexed chunks will be removed. Reindex is not available because source content is not retained.`} confirmLabel="Delete source" busy={remove.isPending} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)} />
    </>
  );
}

export function IntegrationsPage() {
  return <ClientGate>{(clientId) => <IntegrationsContent clientId={clientId} />}</ClientGate>;
}

function IntegrationsContent({ clientId }: { clientId: string }) {
  const status = useQuery({ queryKey: ["integrations", clientId], queryFn: () => api.integrations(clientId), retry: false });
  const known = [
    { id: "twilio", name: "Twilio", description: "Phone numbers, inbound and outbound calling", icon: PhoneCall },
    { id: "calcom", name: "Cal.com", description: "Live availability and appointment booking", icon: CalendarDays },
    { id: "elevenlabs", name: "ElevenLabs", description: "Warm, expressive voice generation", icon: Activity },
    { id: "groq", name: "Groq", description: "Fast speech understanding and reasoning", icon: Zap },
    { id: "stripe", name: "Stripe", description: "Plan, subscription and usage status", icon: CircleDollarSign },
    { id: "gemini", name: "Gemini", description: "Knowledge embeddings and semantic retrieval", icon: BookOpen },
    { id: "database", name: "Postgres + pgvector", description: "Persistent clients, calls and indexed knowledge", icon: Database },
    { id: "redis", name: "Redis", description: "Live call state and concurrency reservations", icon: Database },
    { id: "gateway", name: "Voice gateway", description: "Twilio media streaming and real-time orchestration", icon: Cloud },
  ];
  const byId = new Map((status.data || []).map((item) => [item.id.toLowerCase(), item]));
  return (
    <>
      <PageHeader eyebrow="Integrations" title="Connect the tools behind the conversation" description="Robinexis keeps credentials server-side. This page shows connection health, never secret values." />
      {status.error && <div className="notice notice-error"><div><XCircle /><span><strong>Connection status unavailable.</strong> {status.error.message}</span></div><button onClick={() => status.refetch()}>Retry</button></div>}
      <div className="integration-grid">{known.map(({ id, name, description, icon: Icon }) => { const item = byId.get(id); const connected = item?.connected || false; return <Card className="integration-card" key={id}><div className={`integration-icon integration-${id}`}><Icon /></div><div><h3>{name}</h3><p>{item?.detail || description}</p></div><Badge tone={connected ? "success" : "neutral"}>{status.isLoading ? "Checking…" : connected ? "Connected" : "Needs setup"}</Badge><a className="button button-secondary button-sm" href="mailto:hello@robinexis.com?subject=Robinexis%20integration%20setup">Configure server-side</a></Card>; })}</div>
      <Card className="panel deferred-integration"><div className="deferred-row"><Database /><div><strong>External CRM adapter</strong><p>Call notes are stored locally. GoHighLevel or another CRM can be connected when an adapter is selected.</p></div><Badge tone="neutral">Deferred</Badge></div></Card>
      <Card className="security-strip"><KeyRound /><div><strong>Secrets stay out of the browser</strong><p>API keys and OAuth credentials are configured in the deployment environment. The frontend only receives redacted connection status.</p></div><ShieldCheck /></Card>
    </>
  );
}

export function TeamPage() {
  return (
    <>
      <PageHeader eyebrow="Team" title="Bring your operators together" description="Control who can review calls, tune agents, and publish changes." actions={<Button disabled><UserPlus size={15} /> Invite member</Button>} />
      <Card className="panel"><div className="team-row"><span className="profile-avatar large">RE</span><div><strong>Robinexis admin</strong><small>Current session</small></div><span>Administrator</span><Badge tone="success">Active</Badge><button className="icon-button"><MoreHorizontal /></button></div><EmptyState icon={Users} title="Team invitations are coming soon" description="Access is currently limited to the server allowlist (ADMIN_EMAILS) after a Supabase sign-in. Role-based invitations are not enabled yet." /></Card>
    </>
  );
}

export function BillingPage() {
  return <ClientGate>{(clientId) => <BillingContent clientId={clientId} />}</ClientGate>;
}

function BillingContent({ clientId }: { clientId: string }) {
  const usage = useQuery({ queryKey: ["usage", clientId], queryFn: () => api.usage(clientId), retry: false });
  const client = useQuery({ queryKey: ["client", clientId], queryFn: () => api.client(clientId), retry: false });
  const minutes = (usage.data?.inboundMinutes || 0) + (usage.data?.outboundMinutes || 0);
  const allowance = client.data?.monthlyMinuteLimit || 500;
  const usagePercent = Math.min(100, Math.round((minutes / allowance) * 100));
  if (usage.isLoading || client.isLoading) return <LoadingState label="Loading plan and usage…" />;
  if (usage.error || client.error) return <ErrorState error={usage.error || client.error} onRetry={() => { usage.refetch(); client.refetch(); }} />;
  const product = client.data?.subscribedProduct || "Managed voice service";
  return (
    <>
      <PageHeader eyebrow="Billing" title="A plan that grows with every call" description="Review your current allowance and the features available to this workspace." />
      <div className="billing-grid">
        <Card className="current-plan"><span className="pill pill-light">{client.data?.serviceStatus || "Trial"}</span><h2>{product}</h2><p>{allowance} voice minutes with the workspace features enabled for this client.</p><div className="plan-price"><strong>Managed</strong><span>pricing confirmed off-platform</span></div><a className="button button-secondary button-md" href="mailto:hello@robinexis.com?subject=Manage%20Robinexis%20subscription">Manage subscription</a></Card>
        <Card className="panel usage-card"><SectionHeading title="Monthly usage" description={`Billing period ${usage.data?.month || "current month"}`} /><div className="usage-count"><strong>{minutes}</strong><span>of {allowance} minutes</span></div><div className="progress"><i style={{ width: `${usagePercent}%` }} /></div><p><ShieldCheck /> {usage.isLoading ? "Loading usage…" : usage.error ? "Usage is temporarily unavailable." : `${usage.data?.inboundMinutes || 0} inbound · ${usage.data?.outboundMinutes || 0} outbound minutes`}</p></Card>
      </div>
      <Card className="panel"><SectionHeading title="Billing details" description="Stripe Checkout and self-serve invoices are intentionally deferred." /><div className="deferred-row"><CircleDollarSign /><div><strong>Need to change your plan?</strong><p>Contact Robinexis and we’ll update your subscription securely.</p></div><a className="button button-secondary button-md" href="mailto:hello@robinexis.com">Contact billing</a></div></Card>
    </>
  );
}

export function SettingsPage() {
  const { activeClientId } = useClient();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const client = useQuery({ queryKey: ["client", activeClientId], queryFn: () => api.client(activeClientId!), enabled: Boolean(activeClientId), retry: false });
  const settingsSchema = z.object({ businessName: z.string().min(2), location: z.string().optional(), email: z.string().email().or(z.literal("")), phone: z.string().optional() });
  const form = useForm<z.infer<typeof settingsSchema>>({ values: { businessName: client.data?.businessName || "", location: client.data?.location || "", email: client.data?.email || "", phone: client.data?.phone || "" }, resolver: zodResolver(settingsSchema) });
  const save = useMutation({
    mutationFn: (values: z.infer<typeof settingsSchema>) => api.updateClient(activeClientId!, values),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["client", activeClientId] }), queryClient.invalidateQueries({ queryKey: ["clients"] })]); push({ title: "Settings saved", message: "Republish your agent if these details affect conversations.", tone: "success" }); },
    onError: (error) => push({ title: "Save failed", message: error.message, tone: "error" }),
  });
  if (!activeClientId) return <EmptyState title="No client selected" description="Create or select a client workspace before changing settings." action={<LinkButton to="/app/onboarding">Create client</LinkButton>} />;
  if (client.isLoading) return <LoadingState />;
  if (client.error) return <ErrorState error={client.error} />;
  return (
    <>
      <PageHeader eyebrow="Workspace settings" title="The business behind the voice" description="Manage operational details used across your agents, calls, and reports." />
      <div className="settings-layout">
        <nav className="settings-nav"><a className="active" href="#business"><Settings2 /> Business profile</a><a href="#security"><ShieldCheck /> Security</a><a href="#developer"><Code2 /> Developer</a></nav>
        <div>
          <Card className="form-card" id="business"><SectionHeading title="Business profile" description="Changing approved business details marks the current agent configuration as a draft." /><form onSubmit={form.handleSubmit((values) => save.mutate(values))}><div className="form-grid"><Field label="Business name"><input {...form.register("businessName")} /></Field><Field label="Location"><input {...form.register("location")} /></Field><Field label="Public email"><input {...form.register("email")} /></Field><Field label="Public phone"><input {...form.register("phone")} /></Field></div><div className="form-actions"><Button disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button></div></form></Card>
          <Card className="form-card" id="security"><SectionHeading title="Session security" description="The dashboard stores a short-lived access token for this tab only." /><div className="security-setting"><span><KeyRound /></span><div><strong>Supabase session</strong><p>A signed JWT is sent to the Railway API. The server allowlists operator emails.</p></div><Badge tone="success">Protected</Badge></div></Card>
          <Card className="form-card" id="developer"><SectionHeading title="API environment" description="Set VITE_API_BASE_URL to the Railway API origin in production." /><div className="code-line"><code>/api/v1</code><button className="icon-button" onClick={() => navigator.clipboard.writeText("/api/v1")}><Copy size={16} /></button></div></Card>
        </div>
      </div>
    </>
  );
}
