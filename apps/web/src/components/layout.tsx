import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  CircleDollarSign,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  PhoneCall,
  PlugZap,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, initials } from "../lib/api";
import { AUTH_REQUIRED } from "../lib/auth";
import { useClient, useSession } from "../state";
import { Badge } from "./ui";

const navigation = [
  { label: "Overview", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Agents", to: "/app/agents", icon: Bot },
  { label: "Playground", to: "/app/playground", icon: MessageSquareText },
  { label: "Calls", to: "/app/calls", icon: PhoneCall },
  { label: "Analytics", to: "/app/analytics", icon: BarChart3 },
  { label: "Calendar", to: "/app/calendar", icon: CalendarDays },
  { label: "Knowledge", to: "/app/knowledge", icon: BookOpen },
  { label: "Integrations", to: "/app/integrations", icon: PlugZap },
] as const;

const secondary = [
  { label: "Team", to: "/app/team", icon: Users },
  { label: "Billing", to: "/app/billing", icon: CircleDollarSign },
  { label: "Settings", to: "/app/settings", icon: Settings },
] as const;

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link className={`logo ${light ? "logo-light" : ""}`} to="/">
      <span className="logo-mark"><Sparkles size={18} /></span>
      <span>Robinexis</span>
    </Link>
  );
}

function NavItems({
  actorRole,
  onNavigate,
}: {
  actorRole: "operator" | "salon";
  onNavigate?: () => void;
}) {
  const render = ({ label, to, icon: Icon, ...item }: (typeof navigation)[number] | (typeof secondary)[number]) => (
    <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} end={"end" in item && item.end} key={to} to={to} onClick={onNavigate}>
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
  return (
    <>
      <nav className="sidebar-nav" aria-label="Product navigation">
        {navigation.map(render)}
      </nav>
      <div className="sidebar-spacer" />
      <nav className="sidebar-nav sidebar-secondary" aria-label="Workspace navigation">
        {secondary
          .filter((item) => actorRole === "operator" || item.label !== "Billing")
          .map(render)}
      </nav>
    </>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { clients, activeClient, activeClientId, setActiveClientId } = useClient();
  const { actor, logout } = useSession();
  const actorRole = actor?.role || "operator";
  const navigate = useNavigate();
  const location = useLocation();
  const current = [...navigation, ...secondary].find((item) =>
    item.to === "/app" ? location.pathname === "/app" : location.pathname.startsWith(item.to),
  );
  const integrations = useQuery({
    queryKey: ["shell-integrations", activeClientId],
    queryFn: () => api.integrations(activeClientId!),
    enabled: Boolean(activeClientId),
    staleTime: 60_000,
    retry: false,
  });
  const connected = integrations.data?.filter((item) => item.connected).length || 0;
  const total = integrations.data?.length || 0;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setProfileOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate(AUTH_REQUIRED ? "/login" : "/");
  };

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {mobileOpen && <button aria-label="Close menu" className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-head"><Logo light /><button aria-label="Close navigation" className="icon-button mobile-only" onClick={() => setMobileOpen(false)}><X /></button></div>
        <div className="client-switcher">
          <span className="client-avatar">{initials(activeClient?.businessName || "New workspace")}</span>
          <label>
            <small>{actorRole === "operator" ? "Client workspace" : "Your salon"}</small>
            {actorRole === "operator" || clients.length > 1 ? (
              <select value={activeClientId || ""} onChange={(event) => setActiveClientId(event.target.value)}>
                {!clients.length && <option value="">No clients yet</option>}
                {clients.map((client) => <option value={client.id} key={client.id}>{client.businessName}</option>)}
              </select>
            ) : (
              <strong className="fixed-workspace-name">{activeClient?.businessName || "No workspace"}</strong>
            )}
          </label>
          {(actorRole === "operator" || clients.length > 1) && <ChevronsUpDown size={15} />}
        </div>
        <NavItems actorRole={actorRole} onNavigate={() => setMobileOpen(false)} />
        {activeClientId && <div className="sidebar-health"><span className={connected === total && total ? "health-dot ready" : "health-dot"} /><div><strong>System connections</strong><small>{integrations.isLoading ? "Checking…" : `${connected} of ${total} ready`}</small></div><Link to="/app/integrations">View</Link></div>}
        <div className="sidebar-help">
          <span><Sparkles size={16} /> Need a hand?</span>
          <p>Our team can help tune your agent.</p>
          <a href="mailto:hello@robinexis.com">Talk to Robinexis</a>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <button aria-label="Open navigation" aria-expanded={mobileOpen} className="icon-button mobile-only" onClick={() => setMobileOpen(true)}><Menu /></button>
            <div><small>{actorRole === "operator" ? "Robinexis operations" : activeClient?.businessName || "Salon workspace"}</small><strong>{current?.label || "Robinexis"}</strong></div>
          </div>
          <div className="topbar-actions" ref={profileRef}>
            <Badge tone="accent">Sandbox aware</Badge>
            <Badge tone={actorRole === "operator" ? "accent" : "neutral"}>
              {actorRole === "operator" ? "Operator" : "Salon owner"}
            </Badge>
            {activeClient && <Badge tone={activeClient.access?.inbound ? "success" : activeClient.published ? "accent" : "warning"}>{activeClient.access?.inbound ? "Phone active" : activeClient.published ? "Approved" : "Draft"}</Badge>}
            <button className="profile-button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
              <span className="profile-avatar">RE</span>
              <span className="profile-copy">
                <strong>{actorRole === "operator" ? "Robinexis operator" : actor?.email || "Salon user"}</strong>
                <small>{actorRole === "operator" ? "All workspaces" : "Assigned workspaces only"}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {profileOpen && (
              <div className="profile-menu" role="menu">
                <button onClick={handleLogout}><LogOut size={16} /> Sign out & clear key</button>
              </div>
            )}
          </div>
        </header>
        <main className="page-wrap" id="main-content"><Outlet /></main>
      </div>
    </div>
  );
}

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <Logo />
      <button aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} className="icon-button mobile-only" onClick={() => setOpen((value) => !value)}>{open ? <X /> : <Menu />}</button>
      <nav aria-label="Main navigation" className={open ? "public-nav public-nav-open" : "public-nav"}>
        <a href="/#how-it-works">How it works</a>
        <a href="/#features">Features</a>
        <Link to="/pricing">Pricing</Link>
        <Link to={AUTH_REQUIRED ? "/login" : "/app"}>{AUTH_REQUIRED ? "Log in" : "Open app"}</Link>
        <Link className="button button-primary button-sm" to="/signup">Request demo</Link>
      </nav>
    </header>
  );
}
