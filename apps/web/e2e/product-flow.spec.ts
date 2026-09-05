import { expect, test, type Page } from "@playwright/test";

const client = {
  id: "client_demo",
  slug: "demo-salon",
  businessName: "Demo Salon",
  published: false,
  serviceStatus: "trialing",
  elevenlabsAgentId: "agent_test_demo",
  monthlyMinuteLimit: 100,
};

async function openWorkspaceSession(
  page: Page,
  role: "operator" | "salon" = "operator",
  subscriptionStatus: "trialing" | "active" | "past_due" = "trialing",
) {
  await page.addInitScript(() => {
    sessionStorage.setItem("robinexis_admin_api_key", "test-admin-key");
    sessionStorage.setItem("robinexis_active_client", "client_demo");
  });
  await page.route("**/demo/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: {
      email: role === "operator" ? "operator@robinexis.test" : "owner@demo-salon.test",
      role,
      clientRoles: role === "salon" ? { [client.id]: "owner" } : {},
      capabilities: { administerPlatform: role === "operator", createClients: role === "operator" },
      clientId: role === "salon" ? client.id : undefined,
      subscriptionStatus: role === "salon" ? subscriptionStatus : undefined,
    } });
    if (path === "/api/v1/clients") return route.fulfill({ json: { items: [client] } });
    if (path === "/api/v1/bootstrap") return route.fulfill({ json: {
      clients: [client],
      client,
      summary: { totalCalls: 12, answeredCalls: 11, bookedAppointments: 4, transferredCalls: 1, minutesUsed: 28, bookingRate: 33 },
      recentCalls: [],
      integrations: [{ id: "calcom", name: "Cal.com", connected: true }, { id: "gemini", name: "Gemini", connected: false }],
    } });
    if (path.endsWith("/prompt-versions")) return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/calls") return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/analytics/summary") return route.fulfill({ json: { totalCalls: 0, answeredCalls: 0, bookedAppointments: 0, transferredCalls: 0, minutesUsed: 0, bookingRate: 0 } });
    if (path === "/api/v1/analytics/timeseries") return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/calendar/bookings") return route.fulfill({ json: { items: [{
      uid: "booking_1",
      title: "Cut and finish",
      start: "2026-09-08T10:00:00.000Z",
      end: "2026-09-08T10:45:00.000Z",
      attendeeName: "Alex Customer",
      attendeeEmail: "alex@example.test",
      status: "confirmed",
    }] } });
    if (path === "/api/v1/calendar/slots") return route.fulfill({ json: { items: [{ start: "2026-09-09T11:00:00.000Z" }] } });
    if (path === "/api/v1/jobs" || path === "/api/v1/knowledge/documents") return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/integrations/status") return route.fulfill({ json: { items: [{ id: "calcom", name: "Cal.com", connected: true }] } });
    if (path === "/api/v1/memberships") return route.fulfill({ json: { items: role === "salon" ? [{ id: "member_1", clientId: client.id, email: "owner@demo-salon.test", role: "owner", createdAt: "2026-09-01T00:00:00.000Z" }] : [] } });
    if (path === "/api/v1/usage") return route.fulfill({ json: { clientId: client.id, month: "2026-08", inboundMinutes: 10, outboundMinutes: 2 } });
    if (path === `/api/v1/clients/${client.id}`) return route.fulfill({ json: { ...client, role: "AI receptionist", tone: "Warm and concise", publishedFacts: [], services: [] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

test("public pricing explains the product and access model", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: /simple self-serve plans/i })).toBeVisible();
  await expect(page.getByText(/3-day trial/i).first()).toBeVisible();
});

test("public Blades receptionist is branded and needs no login", async ({ page }) => {
  await page.goto("/demo/blades-hair");
  await expect(page.getByRole("heading", { name: /Meet Sophie, the AI receptionist/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Sophie/i })).toBeVisible();
  await expect(page.getByText(/Powered by Robinexis/i).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
  await expect(page.locator('a[href*="elevenlabs.io"]')).toHaveCount(0);
});

test("operator can open the data-backed overview", async ({ page }) => {
  await openWorkspaceSession(page);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Demo Salon is in good hands/i })).toBeVisible();
  await expect(page.getByText("12", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Needs setup").first()).toBeVisible();
});

test("all operator areas render against their backend contracts", async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkspaceSession(page);
  const routes = [
    ["/app/agents", "Your reception team"],
    [`/app/agents/${client.id}`, "AI receptionist"],
    ["/app/playground", "Your receptionist, ready to talk"],
    ["/app/calls", "Every conversation, accounted for"],
    ["/app/analytics", "Know what’s happening on the phone"],
    ["/app/calendar", "Bookings and availability in one view"],
    ["/app/usage", "Voice minutes, clearly accounted for"],
    ["/app/knowledge", "Give your agent the right answers"],
    ["/app/integrations", "Connect the tools behind the conversation"],
    ["/app/team", "The people behind Demo Salon"],
    ["/app/billing", "A plan that grows with every call"],
    ["/app/settings", "The business behind the voice"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("operator admin is isolated under the admin route", async ({ page }) => {
  await openWorkspaceSession(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "One place to run every client workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Operator admin" })).toHaveCount(0);
  await expect(page.getByText("Client portfolio")).toBeVisible();

  await page.goto("/admin/clients/new");
  await expect(page.getByRole("heading", { name: "Let’s learn the essentials" })).toBeVisible();
});

test("booking workflow exposes filters and details", async ({ page }) => {
  await openWorkspaceSession(page);
  await page.goto("/app/calendar");
  await expect(page.getByPlaceholder("Search customer, email or title…")).toBeVisible();
  await expect(page.getByText("Alex Customer")).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog").getByText("alex@example.test")).toBeVisible();
});

test("salon owners see only their workspace experience", async ({ page }) => {
  await openWorkspaceSession(page, "salon");
  await page.goto("/app");
  await expect(page.getByText("Salon owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo Salon", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Campaigns" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Operator admin" })).toHaveCount(0);

  await page.goto("/app/team");
  await expect(page.locator("#main-content").getByText("owner@demo-salon.test", { exact: true })).toBeVisible();

  await page.goto("/app/billing");
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/app$/);
});

test("unpaid salon deep links are redirected to Sophie with an upgrade action", async ({ page }) => {
  await openWorkspaceSession(page, "salon", "past_due");

  await page.goto("/app/agents");

  await expect(page).toHaveURL(/\/demo\/blades-hair$/);
  await expect(page.getByRole("heading", { name: /Meet Sophie, the AI receptionist/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", "/billing");
});
