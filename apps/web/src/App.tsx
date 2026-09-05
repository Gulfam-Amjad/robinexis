import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout";
import { EmptyState, LinkButton } from "./components/ui";
import { AUTH_REQUIRED } from "./lib/auth";
import { usePermissions } from "./lib/permissions";
import { useSession } from "./state";

const LandingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import("./pages/public").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("./pages/public").then((m) => ({ default: m.SignupPage })));
const AuthCallbackPage = lazy(() => import("./pages/public").then((m) => ({ default: m.AuthCallbackPage })));
const PendingOnboardingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.PendingOnboardingPage })));
const PricingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.PricingPage })));
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
  const { apiKey, actor, actorLoading } = useSession();
  const location = useLocation();
  if (AUTH_REQUIRED && actorLoading) {
    return <div className="not-found">Verifying workspace access…</div>;
  }
  if (AUTH_REQUIRED && (!apiKey || !actor)) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

function RequireWorkspace() {
  const { actor } = useSession();
  return actor?.role === "pending" ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

function RequireOperator() {
  const { actorLoading } = useSession();
  const { actor } = useSession();
  const { canAdministerPlatform } = usePermissions();
  if (actorLoading) return <div className="not-found">Loading workspace…</div>;
  return canAdministerPlatform ? <Outlet /> : <Navigate to={actor?.role === "pending" ? "/dashboard" : "/app"} replace />;
}

function DashboardRoute() {
  const { actor, actorLoading } = useSession();
  if (actorLoading) return <div className="not-found">Loading your dashboard…</div>;
  // TODO(stripe): require an active/trialing subscription here before routing
  // a client actor into /app. Operators and pending onboarding remain exempt.
  if (actor?.role === "operator") return <Navigate to="/admin" replace />;
  if (actor?.role === "salon") return <Navigate to="/app" replace />;
  return <PendingOnboardingPage />;
}

function NotFoundPage() {
  return (
    <div className="not-found">
      <EmptyState title="This page wandered off" description="The route you requested doesn’t exist or may have moved." action={<LinkButton to="/">Back to Robinexis</LinkButton>} />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div className="not-found">Loading…</div>}>
      <Routes>
        <Route path="/" element={AUTH_REQUIRED ? <LandingPage /> : <Navigate to="/app" replace />} />
        <Route path="/login" element={AUTH_REQUIRED ? <LoginPage /> : <Navigate to="/app" replace />} />
        <Route path="/signup" element={AUTH_REQUIRED ? <SignupPage /> : <Navigate to="/app" replace />} />
        <Route path="/auth/callback" element={AUTH_REQUIRED ? <AuthCallbackPage /> : <Navigate to="/app" replace />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/demo/blades-hair" element={<BladesReceptionistDemoPage />} />
        <Route element={<RequireSession />}>
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route element={<RequireWorkspace />}>
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
