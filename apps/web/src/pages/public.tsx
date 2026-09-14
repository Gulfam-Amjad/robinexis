import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarCheck2,
  Check,
  Headphones,
  MessageCircleMore,
  PhoneCall,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { PublicHeader } from "../components/layout";
import { Button, Card, Field } from "../components/ui";
import { AUTH_REQUIRED } from "../lib/auth";
import { api } from "../lib/api";
import {
  authErrorMessage,
  completeAuthCallback,
  selectedPlan,
  signInWithEmail,
  signInWithGoogle,
  validPlan,
  type AuthIntent,
  type AuthPlan,
} from "../lib/supabase";
import { useSession } from "../state";

export function LandingPage() {
  return (
    <div className="public-page">
      <PublicHeader />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="pill"><Sparkles size={14} /> AI reception for customer-first teams</span>
            <h1>Bespoke AI Receptionist</h1>
            <p>Answer every call with a warm, capable receptionist built around your business.</p>
            <p>Robinexis handles enquiries, checks live availability, books appointments, and hands over safely when your team is needed.</p>
            <div className="hero-actions">
              <Link className="button button-primary button-md" to="/signup?plan=starter">Start free trial <ArrowRight size={16} /></Link>
              <Link className="text-link" to="/demo/blades-hair"><span><Play size={14} fill="currentColor" /></span> Try a live receptionist</Link>
            </div>
            <div className="hero-proof">
              <div className="avatar-pile"><span>ER</span><span>WR</span><span>AI</span></div>
              <p><strong>Built alongside real operators</strong><small>Designed for busy, customer-first teams</small></p>
            </div>
          </div>
          <div className="hero-visual">
            <div className="ambient ambient-one" />
            <div className="ambient ambient-two" />
            <div className="call-card">
              <div className="call-card-head">
                <span className="live-dot" />
                <span>Live call</span>
                <small>02:14</small>
              </div>
              <div className="caller">
                <span className="caller-avatar">SM</span>
                <h3>Sarah Mitchell</h3>
                <p>Inbound · Mobile</p>
              </div>
              <div className="waveform">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 13) % 35)}px` }} />)}</div>
              <div className="call-transcript">
                <span className="agent-orb"><Sparkles size={14} /></span>
                <p>“Absolutely — I can check Thursday afternoon for a cut and finish.”</p>
              </div>
              <div className="call-actions" aria-label="Illustrative call controls"><button aria-label="Open messages" type="button"><MessageCircleMore /></button><button aria-label="End call" className="hangup" type="button"><PhoneCall /></button><button aria-label="Listen to call" type="button"><Headphones /></button></div>
            </div>
            <Card className="floating-card floating-booking"><CalendarCheck2 /><div><strong>Appointment booked</strong><span>Thursday · 2:30 PM</span></div><Check /></Card>
            <Card className="floating-card floating-insight"><BarChart3 /><div><span>This week</span><strong>+18% bookings</strong></div></Card>
          </div>
        </section>

        <section className="trust-strip"><span>One calm operating layer for every conversation</span><div><strong>24/7 ANSWERING</strong><strong>LIVE BOOKING</strong><strong>SAFE HANDOFFS</strong><strong>CALL INSIGHTS</strong></div></section>

        <section className="public-section" id="features">
          <div className="section-intro"><span className="eyebrow">Features</span><h2>All the features,<br />none of the headaches</h2><p>Stop losing bookings to missed calls. Robinexis answers, reschedules, and fills your calendar, automatically.</p></div>
          <div className="feature-grid">
            {([
              [PhoneCall, "Answers naturally", "A warm, on-brand voice that handles real conversations, including interruptions and follow-up questions."],
              [CalendarCheck2, "Books while you work", "Checks live availability and creates confirmed appointments without inventing a slot."],
              [ShieldCheck, "Knows its limits", "Works from approved business facts and brings your team in whenever confidence is low."],
              [BarChart3, "Turns calls into insight", "See what customers ask, which calls convert, and where your front desk can improve."],
            ] as const).map(([Icon, title, body]) => (
              <Card className="feature-card" key={String(title)}>
                <div className="feature-icon"><Icon size={22} /></div><h3>{title}</h3><p>{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="steps-section" id="how-it-works">
          <div className="section-intro"><span className="eyebrow">How it works</span><h2>From business brief to a receptionist ready to help</h2><p>Robinexis manages the setup while your team stays in control of the facts and customer experience.</p></div>
          <div className="steps">
            {[
              ["01", "Teach it your business", "Approve the services, opening hours, policies, prices, and handoff rules your receptionist can use."],
              ["02", "Connect live booking", "Link your calendar so Robinexis can check real availability and create confirmed appointments safely."],
              ["03", "Test, launch, improve", "Try realistic calls, launch on your number, then use transcripts and outcomes to keep improving."],
            ].map(([number, title, body]) => <div className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></div>)}
          </div>
        </section>

        <section className="cta-section">
          <span className="pill pill-light"><Sparkles size={14} /> Your next customer is calling</span>
          <h2>Let Robinexis pick up.</h2>
          <p>See how a receptionist trained around your business could answer, help, and book.</p>
          <Link className="button button-light button-md" to="/signup?plan=starter">Start free trial <ArrowRight size={16} /></Link>
        </section>
      </main>
      <footer className="public-footer"><LogoFooter /><span>AI receptionists that answer, help, and book · © 2026 Robinexis</span><div><Link to="/pricing">Pricing</Link><a href="mailto:hello@robinexis.com">Contact</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></footer>
    </div>
  );
}

function LogoFooter() {
  return <Link className="logo logo-light" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link>;
}

const loginSchema = z.object({ email: z.string().email("Enter the allowlisted work email") });
type LoginFields = z.infer<typeof loginSchema>;

function authIntent(search: URLSearchParams, from?: string): AuthIntent {
  const plan = validPlan(search.get("plan"));
  // A prospect who arrived on a plan CTA has already chosen; send them straight
  // into Stripe rather than to a dashboard they cannot open until they pay.
  return {
    plan,
    returnTo: from || (plan ? `/billing?plan=${plan}&startCheckout=1` : "/dashboard"),
  };
}

function GoogleButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button type="button" variant="secondary" className="google-auth-button" onClick={onClick} disabled={busy}>
      <span className="google-mark" aria-hidden="true">G</span>
      {busy ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}

export function LoginPage() {
  const { actor } = useSession();
  const location = useLocation();
  const [search] = useSearchParams();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFields>({ resolver: zodResolver(loginSchema) });
  const [serverError, setServerError] = useState("");
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(false);
  const intent = authIntent(search, (location.state as { from?: string } | null)?.from);
  if (!AUTH_REQUIRED || actor) return <Navigate to="/dashboard" replace />;
  const google = async () => {
    setChecking(true);
    setServerError("");
    try {
      await signInWithGoogle(intent);
    } catch (error) {
      setServerError(authErrorMessage(error, "Google sign-in could not be started."));
      setChecking(false);
    }
  };
  const submit = async ({ email }: LoginFields) => {
    setChecking(true);
    setServerError("");
    setSent(false);
    try {
      await signInWithEmail(email.trim(), intent);
      setSent(true);
    } catch (error) {
      setServerError(authErrorMessage(error, "The workspace could not be reached."));
    } finally {
      setChecking(false);
    }
  };
  return (
    <AuthShell title="Welcome back" copy="Sign in securely to your Robinexis workspace.">
      <GoogleButton onClick={() => void google()} busy={checking} />
      <div className="auth-divider"><span>or use email</span></div>
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field label="Work email" hint="We email a one-time sign-in link. No password is stored here." error={errors.email?.message}>
          <input type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} />
        </Field>
        {serverError && <div className="form-alert" role="alert">{serverError}</div>}
        {sent && <div className="form-success" role="status">Check your inbox for the sign-in link. Open it in this same browser — the link only works where you asked for it.</div>}
        <Button type="submit" disabled={checking}>{checking ? "Sending link…" : "Email me a sign-in link"} <ArrowRight size={16} /></Button>
      </form>
      <div className="auth-note"><ShieldCheck size={17} /><p>The API verifies the signed-in user and enforces their workspace role. The browser never decides which client data they can access.</p></div>
    </AuthShell>
  );
}

export function SignupPage() {
  const { actor } = useSession();
  const [search] = useSearchParams();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFields>({ resolver: zodResolver(loginSchema) });
  const [serverError, setServerError] = useState("");
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(false);
  const intent = authIntent(search);
  if (!AUTH_REQUIRED) return <Navigate to="/app" replace />;
  if (actor) return <Navigate to="/dashboard" replace />;
  const google = async () => {
    setChecking(true);
    setServerError("");
    try {
      await signInWithGoogle(intent);
    } catch (error) {
      setServerError(authErrorMessage(error, "Google sign-up could not be started."));
      setChecking(false);
    }
  };
  const submit = async ({ email }: LoginFields) => {
    setChecking(true);
    setServerError("");
    setSent(false);
    try {
      await signInWithEmail(email.trim(), intent);
      setSent(true);
    } catch (error) {
      setServerError(authErrorMessage(error, "Account creation could not be started."));
    } finally {
      setChecking(false);
    }
  };
  const planLabel = intent.plan ? `${intent.plan[0].toUpperCase()}${intent.plan.slice(1)} plan selected` : "Choose a plan later";
  return (
    <AuthShell title="Create your Robinexis account" copy="Start with Google or a secure email link. We’ll connect your business workspace after sign-up.">
      <div className="selected-plan" role="status">{planLabel}</div>
      <GoogleButton onClick={() => void google()} busy={checking} />
      <div className="auth-divider"><span>or use email</span></div>
      <form className="auth-form" onSubmit={handleSubmit(submit)}>
        <Field label="Work email" hint="Use the email your Robinexis workspace will be assigned to." error={errors.email?.message}>
          <input type="email" autoComplete="email" placeholder="you@company.com" {...register("email")} />
        </Field>
        {serverError && <div className="form-alert" role="alert">{serverError}</div>}
        {sent && <div className="form-success" role="status">Check your inbox to finish creating your account. Open the link in this same browser — it only works where you asked for it.</div>}
        <Button type="submit" disabled={checking}>{checking ? "Sending link…" : "Continue with email"} <ArrowRight size={16} /></Button>
        <small className="form-disclaimer">Starter and Pro include a 3-day trial. Stripe hosts checkout after you sign in.</small>
      </form>
      <p className="auth-switch">Already have access? <Link to={`/login${intent.plan ? `?plan=${intent.plan}` : ""}`}>Log in</Link></p>
    </AuthShell>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { login, logout } = useSession();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void completeAuthCallback()
      .then(async (result) => {
        const actor = await api.session(result.accessToken);
        return { result, actor };
      })
      .then(({ result, actor }) => {
        if (!active) return;
        login(result.accessToken, actor);
        navigate(result.returnTo, { replace: true });
      })
      .catch((cause) => {
        if (!active) return;
        logout();
        const message = cause instanceof Error ? cause.message : "Sign-in could not be completed.";
        setError(
          message === "unauthorized"
            ? "Your Google sign-in completed, but the workspace could not verify the session. Please sign in again."
            : message,
        );
      });
    return () => { active = false; };
  }, [login, logout, navigate]);
  return (
    <AuthShell title={error ? "Sign-in needs attention" : "Finishing sign-in"} copy={error || "Securely connecting your account to Robinexis…"}>
      {error ? <Link className="button button-primary button-md" to="/login">Return to login</Link> : <div className="auth-callback-loader" aria-label="Signing in" />}
    </AuthShell>
  );
}

export function SelfServeBillingPage() {
  const { actor, actorLoading, logout } = useSession();
  const [search] = useSearchParams();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const checkoutStatus = search.get("checkout");
  const selected = validPlan(search.get("plan")) || selectedPlan();
  const paid = actor?.subscriptionStatus === "active" || actor?.subscriptionStatus === "trialing";
  const billing = useQuery({
    queryKey: ["billing-status", actor?.clientId],
    queryFn: () => api.billingStatus(actor?.clientId),
    enabled: Boolean(actor?.clientId),
    retry: false,
  });
  const canManagePortal = Boolean(billing.data?.canManagePortal);
  const recovery = ["past_due", "unpaid", "incomplete"].includes(actor?.subscriptionStatus || "");
  const checkout = useMutation({
    mutationFn: async (plan: AuthPlan) => {
      const result = await api.createCheckout(plan, actor?.clientId);
      if (!result.url) {
        throw new Error("Stripe Checkout did not return a redirect URL. Please retry.");
      }
      return result.url;
    },
    onSuccess: (url) => window.location.assign(url),
  });
  const portal = useMutation({
    mutationFn: () => api.createBillingPortal(actor?.clientId),
    onSuccess: ({ url }) => window.location.assign(url),
  });

  useEffect(() => {
    if (actorLoading || paid || started.current) return;
    if (search.get("startCheckout") !== "1" || !selected) return;
    started.current = true;
    checkout.mutate(selected);
  }, [actorLoading, paid, search, selected, checkout]);

  useEffect(() => {
    if (checkoutStatus !== "success" || paid) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["session-actor"] });
      void queryClient.invalidateQueries({ queryKey: ["billing-status"] });
    };
    refresh();
    const interval = window.setInterval(refresh, 1_500);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 30_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [checkoutStatus, paid, queryClient]);

  if (actorLoading) return <div className="not-found">Loading billing…</div>;
  if (actor?.role === "operator") return <Navigate to="/admin/billing" replace />;

  const error = checkout.error instanceof Error ? checkout.error.message : checkout.error ? "Checkout could not be started." : "";
  return (
    <AuthShell
      title={paid ? "Your Robinexis plan" : recovery && canManagePortal ? "Your billing needs attention" : "Choose a plan to continue"}
      copy={
        checkoutStatus === "success"
          ? "Stripe confirmed checkout. We’ll unlock the dashboard as soon as the subscription is marked trialing or active."
          : paid
            ? billing.data?.trialEndsAt
              ? `Your ${billing.data.plan || "Robinexis"} trial runs until ${new Date(billing.data.trialEndsAt).toLocaleDateString("en-GB")}. Manage payment and cancellation securely in Stripe.`
              : `This workspace is ${actor?.subscriptionStatus}. Manage payment and cancellation securely in Stripe.`
            : "Starter and Pro include a 3-day trial. Stripe securely collects a card now and billing starts only after the trial."
      }
    >
      <div className="auth-note">
        <ShieldCheck size={17} />
        <p>
          Signed in as <strong>{actor?.email}</strong>
          {actor?.subscriptionStatus ? `. Status: ${actor.subscriptionStatus}.` : "."}
        </p>
      </div>
      {checkoutStatus === "cancelled" && (
        <div className="form-alert" role="status">Checkout was cancelled. Pick a plan when you are ready.</div>
      )}
      {checkoutStatus === "success" && !paid && (
        <div className="auth-note" role="status"><p>Payment details are confirmed. Stripe’s subscription update is still arriving; this page refreshes automatically.</p></div>
      )}
      {recovery && canManagePortal && (
        <div className="form-alert" role="alert">Your plan needs attention. Open secure billing to update the payment method or review the subscription.</div>
      )}
      {error && <div className="form-alert" role="alert">{error}</div>}
      {portal.error && <div className="form-alert" role="alert">{portal.error.message}</div>}
      <div className="auth-form">
        {!paid && !canManagePortal && (["starter", "pro"] as const).map((plan) => (
          <Button
            key={plan}
            type="button"
            variant={plan === "pro" ? "primary" : "secondary"}
            disabled={checkout.isPending}
            onClick={() => checkout.mutate(plan)}
          >
            {checkout.isPending && selected === plan
              ? "Opening Stripe…"
              : plan === "starter"
                ? "Starter · £99/month"
                : "Pro · £249/month"}
          </Button>
        ))}
        {canManagePortal && (
          <Button type="button" variant="secondary" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {portal.isPending ? "Opening secure billing…" : "Manage billing in Stripe"}
          </Button>
        )}
        {paid && <Link className="button button-ghost button-md" to={actor?.onboardingStatus === "active" ? "/dashboard" : "/onboarding"}>{actor?.onboardingStatus === "active" ? "Open dashboard" : "Set up my receptionist"}</Link>}
        <Button type="button" variant="ghost" onClick={logout}>Sign out</Button>
      </div>
    </AuthShell>
  );
}

const selfServeOnboardingSchema = z.object({
  businessName: z.string().min(2, "Business name is required"),
  location: z.string().optional(),
  transferNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use an international number such as +447700900123"),
  greeting: z.string().min(8, "Add a short greeting"),
  hours: z.string().min(2, "Add opening hours"),
  prices: z.string().optional(),
  services: z.string().min(3, "Add at least one service"),
  phoneMode: z.enum(["robinexis_account", "customer_oauth"]),
  twilioNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format such as +447700900123").optional().or(z.literal("")),
});

export function SelfServeOnboardingPage() {
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof selfServeOnboardingSchema>>({
    resolver: zodResolver(selfServeOnboardingSchema),
    defaultValues: {
      greeting: "Hello, thanks for calling. How can I help today?",
      phoneMode: "robinexis_account",
    },
  });
  const onboarding = useQuery({
    queryKey: ["self-serve-onboarding", actor?.clientId],
    queryFn: () => api.onboarding(actor!.clientId!),
    enabled: Boolean(actor?.clientId),
    refetchInterval: (query) =>
      ["pending", "running"].includes(query.state.data?.provisioning?.status || "") ? 3_000 : false,
  });
  const finalize = useMutation({
    mutationFn: async (values: z.infer<typeof selfServeOnboardingSchema>) => {
      const services = values.services.split("\n").map((line) => {
        const [title, duration] = line.split("|").map((item) => item.trim());
        return {
          title,
          slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          durationMinutes: Number(duration || 30),
        };
      }).filter((service) => service.title && service.slug && service.durationMinutes > 0);
      return api.finalizeOnboarding(actor!.clientId!, {
        businessName: values.businessName,
        location: values.location,
        transferNumber: values.transferNumber,
        greeting: values.greeting,
        hours: values.hours,
        prices: values.prices,
        services,
        phoneMode: values.phoneMode,
        twilioNumber: values.twilioNumber || undefined,
        publishedFacts: [
          `Opening hours: ${values.hours}`,
          ...(values.prices ? [`Pricing information: ${values.prices}`] : []),
        ],
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session-actor"] }),
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
      ]);
    },
  });

  if (!actor?.clientId) return <Navigate to="/billing" replace />;
  if (actor.subscriptionStatus !== "active" && actor.subscriptionStatus !== "trialing") {
    return <Navigate to="/billing" replace />;
  }
  if (actor.onboardingStatus === "active") return <Navigate to="/app" replace />;
  if (["setup_queued", "setup_in_progress", "needs_attention"].includes(actor.onboardingStatus || "")) {
    const needsAttention = actor.onboardingStatus === "needs_attention";
    const inProgress = actor.onboardingStatus === "setup_in_progress";
    return (
      <AuthShell
        title={needsAttention ? "We need one more detail" : inProgress ? "Your setup is in progress" : "Your setup is in the queue"}
        copy={needsAttention
          ? "A Robinexis specialist has paused setup safely and will contact you before anything goes live."
          : inProgress
            ? "A Robinexis specialist is configuring and testing your receptionist. No phone routing changes are made without review."
            : "Your details are saved. We will review the call flow, calendar and phone setup before activating your receptionist."}
      >
        <div className="setup-progress" role="status">
          {["Payment confirmed", "Business details received", "Specialist setup", "Test and activate"].map((step, index) => (
            <div className={index < (inProgress ? 3 : 2) ? "complete" : needsAttention && index === 2 ? "attention" : ""} key={step}>
              <span>{index + 1}</span><p><strong>{step}</strong><small>{index === 3 ? "Only after your setup is approved" : index < 2 ? "Complete" : index === 2 ? "Robinexis is handling this" : "Next"}</small></p>
            </div>
          ))}
        </div>
        <Link className="button button-secondary button-md full-button" to="/billing">Manage billing</Link>
        <a className="button button-ghost button-md full-button" href="mailto:hello@robinexis.com">Contact setup support</a>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Tell us how your front desk works"
      copy="Submit the essentials now. A Robinexis specialist will review, configure and test your receptionist before anything goes live."
    >
      <form className="auth-form" onSubmit={form.handleSubmit((values) => finalize.mutate(values))}>
        <Field label="Business name" error={form.formState.errors.businessName?.message}><input {...form.register("businessName")} /></Field>
        <Field label="Location"><input placeholder="Leeds, UK" {...form.register("location")} /></Field>
        <Field label="Front-desk transfer number" error={form.formState.errors.transferNumber?.message}><input placeholder="+447700900123" {...form.register("transferNumber")} /></Field>
        <Field label="Opening greeting" error={form.formState.errors.greeting?.message}><textarea rows={2} {...form.register("greeting")} /></Field>
        <Field label="Opening hours" error={form.formState.errors.hours?.message}><textarea rows={3} placeholder="Monday–Friday 9am–6pm" {...form.register("hours")} /></Field>
        <Field label="Services" hint="One per line: Service name | duration minutes" error={form.formState.errors.services?.message}><textarea rows={4} placeholder={"Haircut | 45\nColour consultation | 30"} {...form.register("services")} /></Field>
        <Field label="Prices"><textarea rows={3} placeholder="Haircut from £40" {...form.register("prices")} /></Field>
        <Field label="Phone setup">
          <select {...form.register("phoneMode")}>
            <option value="robinexis_account">I need Robinexis to arrange a number</option>
            <option value="customer_oauth">I already use Twilio / want to keep my number</option>
          </select>
        </Field>
        <Field label="Existing phone number (optional)" hint="Add the number you want to keep or transfer. We will confirm options before changing routing." error={form.formState.errors.twilioNumber?.message}><input placeholder="+44…" {...form.register("twilioNumber")} /></Field>
        {onboarding.data?.provisioning && (
          <div className="auth-note" role="status">
            <p>
              Provisioning: <strong>{onboarding.data.provisioning.status}</strong>
              {onboarding.data.provisioning.step ? ` · ${onboarding.data.provisioning.step}` : ""}
              {onboarding.data.provisioning.error ? `. ${onboarding.data.provisioning.error}. You can safely retry.` : ""}
            </p>
          </div>
        )}
        {finalize.error && <div className="form-alert" role="alert">{finalize.error.message}</div>}
        <Button disabled={finalize.isPending}>{finalize.isPending ? "Submitting securely…" : "Submit for specialist setup"}</Button>
      </form>
    </AuthShell>
  );
}

function AuthShell({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <Link className="logo" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link>
      <div className="auth-layout">
        <section className="auth-card"><span className="eyebrow">Robinexis workspace</span><h1>{title}</h1><p>{copy}</p>{children}</section>
        <aside className="auth-aside"><div className="auth-quote"><Sparkles /><blockquote>“The calls that used to become voicemails now become conversations.”</blockquote><p>Built for teams who care about every caller.</p></div></aside>
      </div>
    </div>
  );
}

export function PricingPage() {
  const plans = [
    { name: "Starter", price: "£99", plan: "starter" as const, copy: "For independent businesses ready to stop missing calls.", features: ["One AI receptionist", "300 included minutes", "Booking & call summaries", "3-day trial"] },
    { name: "Pro", price: "£249", plan: "pro" as const, copy: "For busy teams turning more calls into appointments.", features: ["Everything in Starter", "1,500 included minutes", "Smart rebooking & waitlist", "Revenue recovery dashboard"], featured: true },
    { name: "Enterprise", price: "Let’s talk", copy: "For multi-location teams with more complex workflows.", features: ["Multiple locations", "Custom integrations", "Priority onboarding", "Dedicated optimisation"] },
  ];
  return (
    <div className="public-page pricing-page">
      <PublicHeader />
      <main className="pricing-main">
        <div className="section-intro"><span className="eyebrow">Pricing</span><h1>Simple plans. A receptionist built for you.</h1><p>Start with a 3-day trial on Starter or Pro. Add a card securely in Stripe; you will not be charged until the trial ends.</p></div>
        <div className="pricing-grid">
          {plans.map((plan) => <Card className={`price-card ${plan.featured ? "price-featured" : ""}`} key={plan.name}>
            {plan.featured && <span className="popular">Most popular</span>}
            <h2>{plan.name}</h2><p>{plan.copy}</p><strong>{plan.price}{plan.price.startsWith("£") && <small>/month</small>}</strong>
            {"plan" in plan && plan.plan
              ? <Link className={`button button-${plan.featured ? "primary" : "secondary"} button-md`} to={`/signup?plan=${plan.plan}`}>Start trial <ArrowRight size={15} /></Link>
              : <Link className="button button-secondary button-md" to="/enterprise-contact">Contact sales <ArrowRight size={15} /></Link>}
            <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
          </Card>)}
        </div>
        <p className="pricing-footnote">Secure checkout by Stripe. Prices exclude VAT where applicable. Cancel before the trial ends to avoid a charge.</p>
      </main>
    </div>
  );
}

export function EnterpriseContactPage() {
  return (
    <div className="public-page enterprise-contact-page">
      <PublicHeader />
      <main className="enterprise-main">
        <section className="enterprise-hero">
          <span className="pill"><Building2 size={14} /> Enterprise AI reception</span>
          <h1>A receptionist built around every location.</h1>
          <p>
            Tell us about your teams, call flows, calendars, and integrations. We’ll shape a
            tailored Robinexis demo around the way your business actually works.
          </p>
          <div className="hero-actions">
            <a
              className="button button-primary button-md"
              href="mailto:hello@robinexis.com?subject=Enterprise%20Robinexis"
            >
              Contact sales <ArrowRight size={16} />
            </a>
            <Link className="button button-secondary button-md" to="/pricing">View plans</Link>
          </div>
        </section>
        <Card className="enterprise-card">
          <span className="eyebrow">Designed for complex operations</span>
          <h2>Start with your requirements, not a generic demo.</h2>
          <ul>
            {[
              "Multiple locations and teams",
              "Custom booking and escalation workflows",
              "CRM, calendar, and reporting integrations",
              "Dedicated onboarding and optimisation",
            ].map((feature) => <li key={feature}><Check size={17} />{feature}</li>)}
          </ul>
        </Card>
      </main>
      <footer className="public-footer"><LogoFooter /><span>AI receptionists that answer, help, and book · © 2026 Robinexis</span><div><Link to="/pricing">Pricing</Link><a href="mailto:hello@robinexis.com">Contact</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></footer>
    </div>
  );
}
