import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout";
import { Button, EmptyState, LinkButton } from "./components/ui";
import { AUTH_REQUIRED } from "./lib/auth";
import { usePermissions } from "./lib/permissions";
import {
  canAccessProduct,
  dashboardPath,
  nonAdminPath,
  SOPHIE_DEMO_PATH,
} from "./lib/routing";
import { strayAuthCallback } from "./lib/supabase";
import { useSession } from "./state";

const LandingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import("./pages/public").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("./pages/public").then((m) => ({ default: m.SignupPage })));
const AuthCallbackPage = lazy(() => import("./pages/public").then((m) => ({ default: m.AuthCallbackPage })));
const SelfServeBillingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.SelfServeBillingPage })));
const SelfServeOnboardingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.SelfServeOnboardingPage })));
const PricingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.PricingPage })));
const EnterpriseContactPage = lazy(() => import("./pages/public").then((m) => ({ default: m.EnterpriseContactPage })));
const LegalPage = lazy(() => import("./pages/legal"));
const BladesReceptionistDemoPage = lazy(() => import("./pages/blades-demo"));
const appPages = () => import("./pages/app");

const OverviewPage = lazy(() => appPages().then((m) => ({ default: m.OverviewPage })));
const OnboardingPage = lazy(() => appPages().then((m) => ({ default: m.OnboardingPage })));
const AgentsPage = lazy(() => appPages().then((m) => ({ default: m.AgentsPage })));
const NewAgentPage = lazy(() => appPages().then((m) => ({ default: m.NewAgentPage })));
const AgentDetailPage = lazy(() => appPages().then((m) => ({ default: m.AgentDetailPage })));
const PlaygroundPage = lazy(() => appPages().then((m) => ({ default: m.PlaygroundPage })));
const CallsPage = lazy(() => appPages().then((m) => ({ default: m.CallsPage })));
const CallDetailPage = lazy(() => appPages().then((m) => ({ default: m.CallDetailPage })));
const AnalyticsPage = lazy(() => appPages().then((m) => ({ default: m.AnalyticsPage })));
const CalendarPage = lazy(() => appPages().then((m) => ({ default: m.CalendarPage })));
const UsagePage = lazy(() => appPages().then((m) => ({ default: m.UsagePage })));
const KnowledgePage = lazy(() => appPages().then((m) => ({ default: m.KnowledgePage })));
const IntegrationsPage = lazy(() => appPages().then((m) => ({ default: m.IntegrationsPage })));
const TeamPage = lazy(() => appPages().then((m) => ({ default: m.TeamPage })));
const BillingPage = lazy(() => appPages().then((m) => ({ default: m.BillingPage })));
const SettingsPage = lazy(() => appPages().then((m) => ({ default: m.SettingsPage })));
const AdminOverviewPage = lazy(() => appPages().then((m) => ({ default: m.AdminOverviewPage })));

function RequireSession() {
  const { apiKey, actor, actorError, actorLoading, logout } = useSession();
  const location = useLocation();
  if (AUTH_REQUIRED && actorLoading) {
    return <div className="not-found">Verifying workspace access…</div>;
  }
  if (AUTH_REQUIRED && apiKey && actorError) {
    return (
      <div className="not-found">
        <EmptyState
          title="We could not verify your session"
          description="Your Google sign-in completed, but the workspace session could not be verified. Sign in again to refresh it."
          action={<Button onClick={logout}>Sign in again</Button>}
        />
      </div>
    );
  }
  if (AUTH_REQUIRED && (!apiKey || !actor)) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

function RequireWorkspace() {
  const { actor } = useSession();
  return actor?.role === "pending" ? <Navigate to="/billing" replace /> : <Outlet />;
}

function RequireOperator() {
  const { actorLoading } = useSession();
  const { actor } = useSession();
  const { canAdministerPlatform } = usePermissions();
  if (actorLoading) return <div className="not-found">Loading workspace…</div>;
  return canAdministerPlatform ? <Outlet /> : <Navigate to={nonAdminPath(actor)} replace />;
}

function RequireSubscription() {
  const { actor, actorLoading } = useSession();
  if (actorLoading) return <div className="not-found">Checking your plan…</div>;
  if (!canAccessProduct(actor)) return <Navigate to="/billing" replace />;
  if (
    actor?.role === "salon" &&
    actor.onboardingStatus &&
    actor.onboardingStatus !== "active"
  ) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

function DashboardRoute() {
  const { actor, actorLoading } = useSession();
  if (actorLoading) return <div className="not-found">Loading your dashboard…</div>;
  return <Navigate to={dashboardPath(actor)} replace />;
}

function NotFoundPage() {
  return (
    <div className="not-found">
      <EmptyState title="This page wandered off" description="The route you requested doesn’t exist or may have moved." action={<LinkButton to="/">Back to Robinexis</LinkButton>} />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const strayCallback = AUTH_REQUIRED
    ? strayAuthCallback(location.pathname, location.search, location.hash)
    : undefined;
  if (strayCallback) return <Navigate to={strayCallback} replace />;
  return (
    <Suspense fallback={<div className="not-found">Loading…</div>}>
      <Routes>
        <Route path="/" element={AUTH_REQUIRED ? <LandingPage /> : <Navigate to="/app" replace />} />
        <Route path="/login" element={AUTH_REQUIRED ? <LoginPage /> : <Navigate to="/app" replace />} />
        <Route path="/signup" element={AUTH_REQUIRED ? <SignupPage /> : <Navigate to="/app" replace />} />
        <Route path="/auth/callback" element={AUTH_REQUIRED ? <AuthCallbackPage /> : <Navigate to="/app" replace />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/enterprise-contact" element={<EnterpriseContactPage />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/demo/blades-hair" element={<BladesReceptionistDemoPage />} />
        <Route element={<RequireSession />}>
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/billing" element={<SelfServeBillingPage />} />
          <Route path="/onboarding" element={<SelfServeOnboardingPage />} />
          <Route path="/upgrade" element={<Navigate to="/billing" replace />} />
          <Route element={<RequireWorkspace />}>
            <Route element={<RequireSubscription />}>
            <Route path="/app" element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="agents/:id" element={<AgentDetailPage />} />
              <Route path="playground" element={<PlaygroundPage />} />
              <Route path="calls" element={<CallsPage />} />
              <Route path="calls/:id" element={<CallDetailPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route path="knowledge" element={<KnowledgePage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route element={<RequireOperator />}>
                <Route path="onboarding" element={<Navigate to="/admin/clients/new" replace />} />
                <Route path="agents/new" element={<Navigate to="/admin/agents/new" replace />} />
                <Route path="billing" element={<Navigate to="/admin/billing" replace />} />
              </Route>
            </Route>
            </Route>
            <Route element={<RequireOperator />}>
              <Route path="/admin" element={<AppShell />}>
                <Route index element={<AdminOverviewPage />} />
                <Route path="clients/new" element={<OnboardingPage />} />
                <Route path="agents/new" element={<NewAgentPage />} />
                <Route path="billing" element={<BillingPage />} />
              </Route>
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
