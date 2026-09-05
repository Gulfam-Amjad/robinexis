import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  Check,
  Headphones,
  MessageCircleMore,
  PhoneCall,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { PublicHeader } from "../components/layout";
import { Button, Card, Field } from "../components/ui";
import { AUTH_REQUIRED } from "../lib/auth";
import {
  completeAuthCallback,
  selectedPlan,
  signInWithEmail,
  signInWithGoogle,
  validPlan,
  type AuthIntent,
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
              <Link className="button button-primary button-md" to="/signup">Request your demo <ArrowRight size={16} /></Link>
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
          <Link className="button button-light button-md" to="/signup">Request a live demo <ArrowRight size={16} /></Link>
        </section>
      </main>
      <footer className="public-footer"><LogoFooter /><span>AI receptionists that answer, help, and book · © 2026 Robinexis</span><div><Link to="/pricing">Pricing</Link><a href="mailto:hello@robinexis.com">Contact</a><a href="#">Privacy</a></div></footer>
    </div>
  );
}

function LogoFooter() {
  return <Link className="logo logo-light" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link>;
}

const loginSchema = z.object({ email: z.string().email("Enter the allowlisted work email") });
type LoginFields = z.infer<typeof loginSchema>;

function authIntent(search: URLSearchParams, from?: string): AuthIntent {
  return {
    plan: validPlan(search.get("plan")),
    returnTo: from || "/dashboard",
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
      setServerError(error instanceof Error ? error.message : "Google sign-in could not be started.");
      setChecking(false);
    }
  };
  const submit = async ({ email }: LoginFields) => {
    setChecking(true);
    setServerError("");
    try {
      await signInWithEmail(email.trim(), intent);
      setSent(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "The workspace could not be reached.");
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
        {sent && <div className="form-alert" role="status">Check your inbox for the sign-in link.</div>}
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
  if (!AUTH_REQUIRED || actor) return <Navigate to="/dashboard" replace />;
  const google = async () => {
    setChecking(true);
    setServerError("");
    try {
      await signInWithGoogle(intent);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Google sign-up could not be started.");
      setChecking(false);
    }
  };
  const submit = async ({ email }: LoginFields) => {
    setChecking(true);
    setServerError("");
    try {
      await signInWithEmail(email.trim(), intent);
      setSent(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Account creation could not be started.");
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
        {sent && <div className="form-alert" role="status">Check your inbox to finish creating your account.</div>}
        <Button type="submit" disabled={checking}>{checking ? "Sending link…" : "Continue with email"} <ArrowRight size={16} /></Button>
        <small className="form-disclaimer">Payment is not taken yet. Your selected plan is saved for onboarding.</small>
      </form>
      <p className="auth-switch">Already have access? <Link to={`/login${intent.plan ? `?plan=${intent.plan}` : ""}`}>Log in</Link></p>
    </AuthShell>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void completeAuthCallback()
      .then((intent) => {
        if (active) navigate(intent.returnTo, { replace: true });
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Sign-in could not be completed.");
      });
    return () => { active = false; };
  }, [navigate]);
  return (
    <AuthShell title={error ? "Sign-in needs attention" : "Finishing sign-in"} copy={error || "Securely connecting your account to Robinexis…"}>
      {error ? <Link className="button button-primary button-md" to="/login">Return to login</Link> : <div className="auth-callback-loader" aria-label="Signing in" />}
    </AuthShell>
  );
}

export function PendingOnboardingPage() {
  const { actor, logout } = useSession();
  const plan = selectedPlan();
  return (
    <AuthShell title="Your account is ready" copy="Your business workspace still needs to be assigned by Robinexis.">
      <div className="auth-note"><ShieldCheck size={17} /><p>Signed in as <strong>{actor?.email}</strong>. {plan ? `Your ${plan} plan preference is saved.` : "You can choose a plan during onboarding."}</p></div>
      <div className="auth-form">
        <Link className="button button-primary button-md" to="/demo/blades-hair"><Play size={15} /> Test Sophie</Link>
        <a className="button button-secondary button-md" href="mailto:hello@robinexis.com?subject=Assign%20my%20Robinexis%20workspace">Request workspace access</a>
        <Button type="button" variant="ghost" onClick={logout}>Sign out</Button>
      </div>
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
    { name: "Starter", price: "£149", copy: "For independent businesses ready to stop missing calls.", features: ["One AI receptionist", "150 included minutes", "Booking & call summaries", "Email support"] },
    { name: "Growth", price: "£299", copy: "For busy teams turning more calls into appointments.", features: ["Everything in Starter", "500 included minutes", "Advanced call insights", "Analytics & custom handoffs"], featured: true },
    { name: "Pro", price: "Let’s talk", copy: "For multi-location teams with more complex workflows.", features: ["Multiple locations", "Custom integrations", "Priority onboarding", "Dedicated optimisation"] },
  ];
  return (
    <div className="public-page pricing-page">
      <PublicHeader />
      <main className="pricing-main">
        <div className="section-intro"><span className="eyebrow">Pricing</span><h1>Simple managed plans</h1><p>Guide pricing for a receptionist configured and supported by Robinexis. Final scope is confirmed before activation.</p></div>
        <div className="pricing-grid">
          {plans.map((plan) => <Card className={`price-card ${plan.featured ? "price-featured" : ""}`} key={plan.name}>
            {plan.featured && <span className="popular">Most popular</span>}
            <h2>{plan.name}</h2><p>{plan.copy}</p><strong>{plan.price}{plan.price.startsWith("£") && <small>/month</small>}</strong>
            <Link className={`button button-${plan.featured ? "primary" : "secondary"} button-md`} to="/signup">Request access <ArrowRight size={15} /></Link>
            <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
          </Card>)}
        </div>
        <p className="pricing-footnote">Guide pricing only. Final allowance, overage and VAT are confirmed by the Robinexis team before activation; self-serve checkout is not yet available.</p>
      </main>
    </div>
  );
}
