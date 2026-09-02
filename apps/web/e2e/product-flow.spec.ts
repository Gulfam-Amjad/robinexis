import { expect, test, type Page } from "@playwright/test";

const client = {
  id: "client_demo",
  slug: "demo-salon",
  businessName: "Demo Salon",
  published: false,
  serviceStatus: "trialing",
};

async function openOperatorSession(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("robinexis_admin_api_key", "test-admin-key");
    sessionStorage.setItem("robinexis_active_client", "client_demo");
  });
  await page.route("**/demo/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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
    if (path === "/api/v1/calendar/bookings" || path === "/api/v1/calendar/slots" || path === "/api/v1/jobs" || path === "/api/v1/knowledge/documents") return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/integrations/status") return route.fulfill({ json: { items: [{ id: "calcom", name: "Cal.com", connected: true }] } });
    if (path === "/api/v1/usage") return route.fulfill({ json: { clientId: client.id, month: "2026-08", inboundMinutes: 10, outboundMinutes: 2 } });
    if (path === `/api/v1/clients/${client.id}`) return route.fulfill({ json: { ...client, role: "AI receptionist", tone: "Warm and concise", publishedFacts: [], services: [] } });
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

test("public pricing explains the product and access model", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: /better front desk/i })).toBeVisible();
  await expect(page.getByText(/self-serve checkout is not yet available/i)).toBeVisible();
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
  await openOperatorSession(page);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Demo Salon is in good hands/i })).toBeVisible();
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs setup")).toBeVisible();
});

test("all operator areas render against their backend contracts", async ({ page }) => {
  test.setTimeout(60_000);
  await openOperatorSession(page);
  const routes = [
    ["/app/agents", "Your reception team"],
    [`/app/agents/${client.id}`, "AI receptionist"],
    ["/app/playground", "Your receptionist, ready to talk"],
    ["/app/calls", "Every conversation, accounted for"],
    ["/app/analytics", "Know what’s happening on the phone"],
    ["/app/calendar", "Appointments in one calm view"],
    ["/app/campaigns", "Thoughtful follow-up, at the right time"],
    ["/app/knowledge", "Give your agent the right answers"],
    ["/app/integrations", "Connect the tools behind the conversation"],
    ["/app/team", "Bring your operators together"],
    ["/app/billing", "A plan that grows with every call"],
    ["/app/settings", "The business behind the voice"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});
