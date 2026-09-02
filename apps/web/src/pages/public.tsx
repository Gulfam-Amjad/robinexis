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
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate } from "react-router-dom";
import { z } from "zod";
import { PublicHeader } from "../components/layout";
import { Button, Card, Field } from "../components/ui";
import { AUTH_REQUIRED } from "../lib/auth";
import { signInWithEmail } from "../lib/supabase";
import { useSession, useToast } from "../state";

export function LandingPage() {
  return (
    <div className="public-page">
      <PublicHeader />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="pill"><Sparkles size={14} /> The front desk that never misses a call</span>
            <h1>Every call answered.<br /><em>Every opportunity captured.</em></h1>
            <p>Robinexis gives service businesses a warm, capable AI receptionist that answers naturally, books appointments, and keeps your team in control.</p>
            <div className="hero-actions">
              <Link className="button button-primary button-md" to="/signup">Build your receptionist <ArrowRight size={16} /></Link>
              <Link className="text-link" to="/signup"><span><Play size={14} fill="currentColor" /></span> Request a live demo</Link>
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
          <div className="section-intro"><span className="eyebrow">Calm, capable, always on</span><h2>Your best receptionist,<br />available on every call.</h2><p>More than an answering service. Robinexis understands your business, takes action, and hands over gracefully when a human touch matters.</p></div>
          <div className="feature-grid">
            {([
              [PhoneCall, "Answers naturally", "A warm, on-brand voice that handles real conversations — including interruptions and follow-up questions."],
              [CalendarCheck2, "Books while you work", "Checks live availability, books, reschedules, and cancels appointments with proper confirmation."],
              [ShieldCheck, "Knows its limits", "Works only from approved business facts and brings your team in whenever confidence is low."],
              [BarChart3, "Turns calls into insight", "See what customers ask, which calls convert, and where your front desk can improve."],
            ] as const).map(([Icon, title, body]) => (
              <Card className="feature-card" key={String(title)}>
                <div className="feature-icon"><Icon size={22} /></div><h3>{title}</h3><p>{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="steps-section" id="how-it-works">
          <div className="section-intro"><span className="eyebrow">From hello to live</span><h2>Set up in an afternoon.<br />Improve every day.</h2></div>
          <div className="steps">
            {[
              ["01", "Tell us about your business", "Add services, policies, opening hours and the facts your agent can safely share."],
              ["02", "Shape the conversation", "Choose the voice, tone, greeting and handoff rules that feel like your team."],
              ["03", "Test, publish, learn", "Try real scenarios in the playground, go live, then use call insights to keep improving."],
            ].map(([number, title, body]) => <div className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></div>)}
          </div>
        </section>

        <section className="cta-section">
          <span className="pill pill-light"><Sparkles size={14} /> Your next customer is calling</span>
          <h2>Let Robinexis pick up.</h2>
          <p>Give every caller an immediate, thoughtful response — even when your team is busy doing their best work.</p>
          <Link className="button button-light button-md" to="/signup">Start building <ArrowRight size={16} /></Link>
        </section>
      </main>
      <footer className="public-footer"><LogoFooter /><span>© 2026 Robinexis. Made in the UK.</span><div><Link to="/pricing">Pricing</Link><a href="mailto:hello@robinexis.com">Contact</a><a href="#">Privacy</a></div></footer>
    </div>
  );
}

function LogoFooter() {
  return <Link className="logo logo-light" to="/"><span className="logo-mark"><Sparkles size={18} /></span><span>Robinexis</span></Link>;
}

const loginSchema = z.object({ email: z.string().email("Enter the allowlisted work email") });
type LoginFields = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { apiKey } = useSession();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFields>({ resolver: zodResolver(loginSchema) });
  const [serverError, setServerError] = useState("");
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState(false);
  if (!AUTH_REQUIRED || apiKey) return <Navigate to="/app" replace />;
  const submit = async ({ email }: LoginFields) => {
    setChecking(true);
    setServerError("");
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "The workspace could not be reached.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <AuthShell title="Welcome back" copy="Sign in with a magic link. Robinexis operators and assigned salon teams can open their workspaces.">
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

const signupSchema = z.object({
  name: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid work email"),
  business: z.string().min(2, "Enter your business name"),
});

export function SignupPage() {
  const { push } = useToast();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema) });
  return (
    <AuthShell title="Meet your new receptionist" copy="Tell us where to reach you and we’ll help create your first voice agent.">
      <form className="auth-form" onSubmit={handleSubmit(() => { push({ title: "You’re on the list", message: "Self-serve account creation is coming soon. We’ll be in touch.", tone: "success" }); reset(); })}>
        <div className="form-grid">
          <Field label="Your name" error={errors.name?.message}><input placeholder="Alex Morgan" {...register("name")} /></Field>
          <Field label="Work email" error={errors.email?.message}><input type="email" placeholder="alex@business.co.uk" {...register("email")} /></Field>
        </div>
        <Field label="Business name" error={errors.business?.message}><input placeholder="Flourish Salon" {...register("business")} /></Field>
        <Button type="submit">Request early access <ArrowRight size={16} /></Button>
        <small className="form-disclaimer">Account provisioning is currently completed by the Robinexis team.</small>
      </form>
      <p className="auth-switch">Already have access? <Link to="/login">Log in</Link></p>
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
        <div className="section-intro"><span className="eyebrow">Simple, useful pricing</span><h1>A better front desk,<br />without the overhead.</h1><p>Start with the calls you miss today. Scale when Robinexis proves its value.</p></div>
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
