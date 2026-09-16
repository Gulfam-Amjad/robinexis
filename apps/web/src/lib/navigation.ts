export type WorkspaceNavigationIcon =
  | "home" | "bot" | "test" | "calls" | "calendar" | "insights"
  | "business" | "knowledge" | "connections" | "setup" | "usage"
  | "team" | "alerts" | "support" | "settings";

export type WorkspaceNavigationItem = {
  label: string;
  suffix: string;
  icon: WorkspaceNavigationIcon;
  end?: boolean;
};

export const workspaceNavigationSections: Array<{
  label: string;
  items: WorkspaceNavigationItem[];
}> = [
  { label: "Workspace", items: [{ label: "Today", suffix: "", icon: "home", end: true }] },
  {
    label: "Receptionist",
    items: [
      { label: "Your receptionist", suffix: "receptionist", icon: "bot" },
      { label: "Test call", suffix: "test", icon: "test" },
    ],
  },
  {
    label: "Activity",
    items: [
      { label: "Calls", suffix: "calls", icon: "calls" },
      { label: "Bookings", suffix: "bookings", icon: "calendar" },
      { label: "Insights", suffix: "insights", icon: "insights" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Business", suffix: "business", icon: "business" },
      { label: "Knowledge", suffix: "knowledge", icon: "knowledge" },
      { label: "Phone & calendar", suffix: "connections", icon: "connections" },
      { label: "Go-live checklist", suffix: "setup", icon: "setup" },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Plan & usage", suffix: "usage", icon: "usage" },
      { label: "Team", suffix: "team", icon: "team" },
      { label: "Alerts", suffix: "alerts", icon: "alerts" },
      { label: "Support", suffix: "support", icon: "support" },
      { label: "Settings", suffix: "settings", icon: "settings" },
    ],
  },
];

export function workspacePath(clientId: string | undefined, suffix = ""): string {
  if (!clientId) return "/app";
  const root = `/app/w/${encodeURIComponent(clientId)}`;
  return suffix ? `${root}/${suffix.replace(/^\/+/, "")}` : root;
}
