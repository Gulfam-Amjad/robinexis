import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout";
import { EmptyState, LinkButton } from "./components/ui";
import { AUTH_REQUIRED } from "./lib/auth";
import { useSession } from "./state";

const LandingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import("./pages/public").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("./pages/public").then((m) => ({ default: m.SignupPage })));
const PricingPage = lazy(() => import("./pages/public").then((m) => ({ default: m.PricingPage })));
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
const CampaignsPage = lazy(() => appPages().then((m) => ({ default: m.CampaignsPage })));
const KnowledgePage = lazy(() => appPages().then((m) => ({ default: m.KnowledgePage })));
const IntegrationsPage = lazy(() => appPages().then((m) => ({ default: m.IntegrationsPage })));
const TeamPage = lazy(() => appPages().then((m) => ({ default: m.TeamPage })));
const BillingPage = lazy(() => appPages().then((m) => ({ default: m.BillingPage })));
const SettingsPage = lazy(() => appPages().then((m) => ({ default: m.SettingsPage })));

function RequireSession() {
  const { apiKey } = useSession();
  const location = useLocation();
  if (AUTH_REQUIRED && !apiKey) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
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
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route element={<RequireSession />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="agents/new" element={<NewAgentPage />} />
            <Route path="agents/:id" element={<AgentDetailPage />} />
            <Route path="playground" element={<PlaygroundPage />} />
            <Route path="calls" element={<CallsPage />} />
            <Route path="calls/:id" element={<CallDetailPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="campaigns" element={<CampaignsPage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
