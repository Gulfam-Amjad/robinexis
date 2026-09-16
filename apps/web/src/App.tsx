import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
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
import { workspacePath } from "./lib/navigation";
import { useClient, useSession } from "./state";

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
const controlPlanePages = () => import("./pages/app/control-planes");
const adminOperationsPages = () => import("./pages/admin/operations");
const adminCustomerPages = () => import("./pages/admin/customers");
const adminUsagePages = () => import("./pages/admin/usage-cost");
const AlertsPage = lazy(() => import("./pages/app/alerts").then((m) => ({ default: m.AlertsPage })));

const OverviewPage = lazy(() => appPages().then((m) => ({ default: m.OverviewPage })));
const SetupPage = lazy(() => controlPlanePages().then((m) => ({ default: m.SetupPage })));
const BusinessPage = lazy(() => controlPlanePages().then((m) => ({ default: m.BusinessPage })));
const PhonePage = lazy(() => controlPlanePages().then((m) => ({ default: m.PhonePage })));
const CalendarSettingsPage = lazy(() => controlPlanePages().then((m) => ({ default: m.CalendarSettingsPage })));
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
const SupportPage = lazy(() => appPages().then((m) => ({ default: m.SupportPage })));
const AdminOperationsPage = lazy(() => adminOperationsPages().then((m) => ({ default: m.AdminOperationsPage })));
const AdminCustomersPage = lazy(() => adminCustomerPages().then((m) => ({ default: m.AdminCustomersPage })));
const AdminCustomerDetailPage = lazy(() => adminCustomerPages().then((m) => ({ default: m.AdminCustomerDetailPage })));
const AdminUsageCostPage = lazy(() => adminUsagePages().then((m) => ({ default: m.AdminUsageCostPage })));
const AdminControlPlanePage = lazy(() => controlPlanePages().then((m) => ({ default: m.AdminControlPlanePage })));
const SetupConsolePage = lazy(() => appPages().then((m) => ({ default: m.SetupConsolePage })));

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

function WorkspaceRouteScope() {
  const { workspaceId } = useParams();
  const { clients, activeClientId, setActiveClientId, isLoading } = useClient();
  const decodedId = workspaceId ? decodeURIComponent(workspaceId) : undefined;
  const allowed = clients.some((client) => client.id === decodedId);
  useEffect(() => {
    if (allowed && decodedId && decodedId !== activeClientId) setActiveClientId(decodedId);
  }, [activeClientId, allowed, decodedId, setActiveClientId]);
  if (isLoading) return <div className="not-found">Loading workspace…</div>;
  if (!allowed) return <Navigate to={workspacePath(clients[0]?.id)} replace />;
  if (activeClientId !== decodedId) return <div className="not-found">Opening workspace…</div>;
  return <Outlet />;
}

function LegacyWorkspaceRedirect() {
  const { "*": legacy = "" } = useParams();
  const { clients, activeClientId, isLoading } = useClient();
  if (isLoading) return <div className="not-found">Loading workspace…</div>;
  const clientId = activeClientId || clients[0]?.id;
  if (!clientId) return <Navigate to="/dashboard" replace />;
  const parts = legacy.split("/").filter(Boolean);
  const first = parts[0] || "";
  const suffix =
    first === "agents" ? `receptionist${parts.length > 1 ? "/edit" : ""}` :
    first === "playground" ? "test" :
    first === "calendar" ? `bookings${parts[1] === "settings" ? "/settings" : ""}` :
    first === "analytics" ? "insights" :
    first === "integrations" ? "connections" :
    first === "phone" ? "connections/phone" :
    first === "billing" || first === "onboarding" ? "" :
    legacy;
  return <Navigate to={workspacePath(clientId, suffix)} replace />;
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
              <Route path="/app/w/:workspaceId" element={<WorkspaceRouteScope />}>
                <Route element={<AppShell />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="setup" element={<SetupPage />} />
                  <Route path="business" element={<BusinessPage />} />
                  <Route path="connections" element={<IntegrationsPage />} />
                  <Route path="connections/phone" element={<PhonePage />} />
                  <Route path="receptionist" element={<AgentsPage />} />
                  <Route path="receptionist/edit" element={<AgentDetailPage />} />
                  <Route path="test" element={<PlaygroundPage />} />
                  <Route path="calls" element={<CallsPage />} />
                  <Route path="calls/:id" element={<CallDetailPage />} />
                  <Route path="insights" element={<AnalyticsPage />} />
                  <Route path="bookings" element={<CalendarPage />} />
                  <Route path="bookings/settings" element={<CalendarSettingsPage />} />
                  <Route path="usage" element={<UsagePage />} />
                  <Route path="knowledge" element={<KnowledgePage />} />
                  <Route path="team" element={<TeamPage />} />
                  <Route path="alerts" element={<AlertsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="support" element={<SupportPage />} />
                </Route>
              </Route>
              <Route path="/app/*" element={<LegacyWorkspaceRedirect />} />
            </Route>
            <Route element={<RequireOperator />}>
              <Route path="/admin" element={<AppShell />}>
                <Route index element={<AdminOperationsPage />} />
                <Route path="customers" element={<AdminCustomersPage />} />
                <Route path="customers/:id" element={<AdminCustomerDetailPage />} />
                <Route path="usage-cost" element={<AdminUsageCostPage />} />
                <Route path="control-plane" element={<AdminControlPlanePage />} />
                <Route path="setup/:id" element={<SetupConsolePage />} />
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
