import {
  BarChart3,
  Bell,
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
  Network,
  PhoneCall,
  PlugZap,
  Search,
  Settings,
  Sparkles,
  Store,
  ListChecks,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, initials } from "../lib/api";
import { AUTH_REQUIRED } from "../lib/auth";
import { workspaceNavigationSections, workspacePath, type WorkspaceNavigationIcon } from "../lib/navigation";
import { usePermissions } from "../lib/permissions";
import { useClient, useSession } from "../state";
import { Badge } from "./ui";

const adminNavigation = [
  { label: "Operations", to: "/admin", icon: LayoutDashboard, end: true },
  { label: "Customers", to: "/admin/customers", icon: Users },
  { label: "Voice routing", to: "/admin/voice-routing", icon: Network },
  { label: "Usage & cost", to: "/admin/usage-cost", icon: CircleDollarSign },
  { label: "Control plane", to: "/admin/control-plane", icon: ListChecks },
  { label: "Add customer", to: "/admin/clients/new", icon: Users },
] as const;

type NavigationItem = { label: string; to: string; icon: LucideIcon; end?: boolean };
const workspaceIcons: Record<WorkspaceNavigationIcon, LucideIcon> = {
  home: LayoutDashboard,
  bot: Bot,
  test: MessageSquareText,
  calls: PhoneCall,
  calendar: CalendarDays,
  insights: BarChart3,
  business: Store,
  knowledge: BookOpen,
  connections: PlugZap,
  setup: ListChecks,
  usage: CircleDollarSign,
  team: Users,
  alerts: Bell,
  support: MessageSquareText,
  settings: Settings,
};

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link className={`logo ${light ? "logo-light" : ""}`} to="/">
      <span className="logo-mark"><Sparkles size={18} /></span>
      <span>Robinexis</span>
    </Link>
  );
}

function NavItems({
  isOperator,
  adminArea,
  activeClientId,
  onNavigate,
}: {
  isOperator: boolean;
  adminArea: boolean;
  activeClientId?: string;
  onNavigate?: () => void;
}) {
  const render = ({ label, to, icon: Icon, end }: NavigationItem) => (
    <NavLink className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} end={end} key={to} to={to} onClick={onNavigate}>
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
  return (
    <>
      {adminArea ? <>
        <span className="nav-scope-label">Platform</span>
        <nav className="sidebar-nav" aria-label="Product navigation">{adminNavigation.map(render)}</nav>
      </> : workspaceNavigationSections.map((section) => <div className="nav-section" key={section.label}>
        <span className="nav-scope-label">{section.label}</span>
        <nav className="sidebar-nav" aria-label={section.label === "Workspace" ? "Product navigation" : `${section.label} navigation`}>
          {section.items.map((item) => render({
            label: item.label,
            to: workspacePath(activeClientId, item.suffix),
            icon: workspaceIcons[item.icon],
            end: item.end,
          }))}
        </nav>
      </div>)}
      <div className="sidebar-spacer" />
      <nav className="sidebar-nav sidebar-secondary" aria-label="Workspace navigation">
        {adminArea
          ? render({ label: "Client workspace", to: workspacePath(activeClientId), icon: LayoutDashboard, end: true })
          : null}
        {!adminArea && isOperator && render({ label: "Operator admin", to: "/admin", icon: Settings })}
      </nav>
    </>
  );
}

function WorkspaceSwitcher({
  clients,
  activeClientId,
  activeName,
  label,
  onSelect,
}: {
  clients: Array<{ id: string; businessName: string; slug: string }>;
  activeClientId?: string;
  activeName: string;
  label: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const switcherRef = useRef<HTMLDivElement>(null);
  const filtered = clients.filter((client) =>
    `${client.businessName} ${client.slug}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return <div className="client-switcher-wrap" ref={switcherRef}>
    <button className="client-switcher" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setSearch(""); setOpen((value) => !value); }}>
      <span className="client-avatar">{initials(activeName)}</span>
      <span className="client-switcher-copy"><small>{label}</small><strong>{activeName}</strong></span>
      <ChevronsUpDown size={15} />
    </button>
    {open && <div className="workspace-picker">
      <label><span className="sr-only">Search workspaces</span><Search size={15} /><input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workspaces" /></label>
      <div role="listbox" aria-label="Select workspace">
        {filtered.map((client) => <button role="option" aria-selected={client.id === activeClientId} type="button" key={client.id} onClick={() => { onSelect(client.id); setOpen(false); }}>
          <span>{client.businessName}</span><small>{client.slug}</small>
        </button>)}
        {!filtered.length && <p>No matching workspaces</p>}
      </div>
    </div>}
  </div>;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { clients, activeClient, activeClientId, setActiveClientId } = useClient();
  const { actor, logout } = useSession();
  const { isOperator } = usePermissions(activeClientId);
  const actorRole = isOperator ? "operator" : "salon";
  const navigate = useNavigate();
  const location = useLocation();
  const adminArea = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const currentWorkspaceSuffix = location.pathname.match(/^\/app\/w\/[^/]+\/?(.*)$/)?.[1] || "";
  const selectWorkspace = (id: string) => {
    setActiveClientId(id);
    if (!adminArea) navigate(workspacePath(id, currentWorkspaceSuffix));
  };
  const current = adminArea
    ? adminNavigation.find((item) => "end" in item && item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))
    : workspaceNavigationSections.flatMap((section) => section.items).find((item) => {
      const target = workspacePath(activeClientId, item.suffix);
      return item.end ? location.pathname === target : location.pathname.startsWith(target);
    });
  const integrations = useQuery({
    queryKey: ["shell-integrations", activeClientId],
    queryFn: () => api.integrations(activeClientId!),
    enabled: Boolean(activeClientId) && !adminArea,
    staleTime: 60_000,
    retry: false,
  });
  const connected = integrations.data?.filter((item) => item.connected).length || 0;
  const total = integrations.data?.length || 0;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProfileOpen(false);
      setMobileOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

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
        {actorRole === "operator" || clients.length > 1 ? <WorkspaceSwitcher clients={clients} activeClientId={activeClientId} activeName={activeClient?.businessName || "No workspace selected"} label={adminArea ? "Workspace context" : "Current workspace"} onSelect={selectWorkspace} /> : <div className="client-switcher client-switcher-fixed"><span className="client-avatar">{initials(activeClient?.businessName || "No workspace")}</span><span className="client-switcher-copy"><small>Your workspace</small><strong>{activeClient?.businessName || "No workspace"}</strong></span></div>}
        <NavItems isOperator={isOperator} adminArea={adminArea} activeClientId={activeClientId} onNavigate={() => setMobileOpen(false)} />
        {!adminArea && activeClientId && <div className="sidebar-health"><span className={connected === total && total ? "health-dot ready" : "health-dot"} /><div><strong>System connections</strong><small>{integrations.isLoading ? "Checking…" : `${connected} of ${total} ready`}</small></div><Link to="/app/integrations">View</Link></div>}
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
            <div><small>{adminArea ? "Platform" : `Workspace · ${activeClient?.businessName || "No selection"}`}</small><strong>{current?.label || "Robinexis"}</strong></div>
          </div>
          <div className="topbar-actions" ref={profileRef}>
            <Badge tone={actorRole === "operator" ? "accent" : "neutral"}>
              {actorRole === "operator" ? "Operator" : "Salon owner"}
            </Badge>
            {activeClient && <Badge tone={activeClient.access?.inbound ? "success" : activeClient.published ? "accent" : "warning"}>{activeClient.access?.inbound ? "Phone active" : activeClient.published ? "Approved" : "Draft"}</Badge>}
            <button className="profile-button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
              <span className="profile-avatar">{initials(actor?.email || "Salon user")}</span>
              <span className="profile-copy">
                <strong>{actorRole === "operator" ? "Robinexis operator" : actor?.email || "Salon user"}</strong>
                <small>{actorRole === "operator" ? "All workspaces" : "Assigned workspaces only"}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {profileOpen && (
              <div className="profile-menu" role="menu">
                <button onClick={handleLogout}><LogOut size={16} /> Sign out</button>
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
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <header className="public-header">
      <Logo />
      <button aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} className="icon-button mobile-only" onClick={() => setOpen((value) => !value)}>{open ? <X /> : <Menu />}</button>
      <nav aria-label="Main navigation" className={open ? "public-nav public-nav-open" : "public-nav"}>
        <a href="/#how-it-works" onClick={() => setOpen(false)}>How it works</a>
        <a href="/#features" onClick={() => setOpen(false)}>Features</a>
        <Link to="/pricing" onClick={() => setOpen(false)}>Pricing</Link>
        <Link to={AUTH_REQUIRED ? "/login" : "/app"} onClick={() => setOpen(false)}>{AUTH_REQUIRED ? "Log in" : "Open app"}</Link>
        <Link className="button button-primary button-sm" to="/signup?plan=starter" onClick={() => setOpen(false)}>Start free trial</Link>
      </nav>
    </header>
  );
}
