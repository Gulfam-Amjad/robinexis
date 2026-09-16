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
  onboardingStatus?: "details_required" | "setup_queued" | "setup_in_progress" | "needs_attention" | "active",
  withOnboarding = false,
  savedStep: "website" | "facts" | "behavior" | "operations" | "phone" | "calendar" | "review" = "website",
  workspaceRole: "owner" | "manager" | "viewer" = "owner",
) {
  let lifecycleStatus = onboardingStatus;
  let storedLaunchGate: Record<string, unknown> | undefined;
  const wizardSteps = ["website", "facts", "behavior", "operations", "phone", "calendar", "review"] as const;
  const wizard = {
    clientId: client.id,
    currentStep: savedStep as string,
    completedSteps: [...wizardSteps.slice(0, wizardSteps.indexOf(savedStep))] as string[],
    data: {
      ...(savedStep === "website" ? {} : { websiteUrl: "https://demo.example", websiteRunId: "run_1" }),
      businessName: "Demo Salon",
      greeting: "Hello, thanks for calling Demo Salon. How can I help?",
      tone: "Warm and concise",
      transferNumber: "+447700900123",
      services: [{ title: "Cut", slug: "cut", durationMinutes: 30 }],
      hours: "Monday–Friday, 9am–5pm",
      timezone: "Europe/London",
      bookingRules: "Please give 24 hours notice for cancellations.",
      phoneMode: "managed",
      calendarMode: "managed_calcom",
    } as Record<string, unknown>,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const facts = [
    { id: "fact_name", key: "businessName", value: "Demo Salon", reviewStatus: "extracted" },
    { id: "fact_hours", key: "hours", value: "Monday–Friday, 9am–5pm", reviewStatus: "extracted" },
  ];
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
      clientRoles: role === "salon" ? { [client.id]: workspaceRole } : {},
      capabilities: { administerPlatform: role === "operator", createClients: role === "operator" },
      clientId: role === "salon" ? client.id : undefined,
      subscriptionStatus: role === "salon" ? subscriptionStatus : undefined,
      onboardingStatus: role === "salon" ? lifecycleStatus : undefined,
    } });
    if (path === "/api/v1/clients") return route.fulfill({ json: { items: [client] } });
    if (path === "/api/v1/bootstrap") return route.fulfill({ json: {
      clients: [client],
      client,
      summary: { totalCalls: 12, answeredCalls: 11, bookedAppointments: 4, transferredCalls: 1, minutesUsed: 28, bookingRate: 33 },
      recentCalls: [],
      integrations: [{ id: "calcom", name: "Cal.com", connected: true }, { id: "gemini", name: "Gemini", connected: false }],
    } });
    if (path === "/api/v1/admin/summary") return route.fulfill({ json: {
      month: "2026-08",
      mrrPence: 0,
      totalUsedMinutes: 12,
      totalFailedCalls: 0,
      setupQueueCount: 0,
      failedBillingEvents: [],
      clients: [{ clientId: client.id, plan: "starter", subscriptionStatus: "trialing", usedMinutes: 12, remainingMinutes: 88, failedCalls: 0 }],
    } });
    if (path === "/api/v1/admin/control-plane") return route.fulfill({ json: {
      generatedAt: "2026-09-15T12:00:00.000Z",
      health: {
        status: "ok",
        notificationQueue: { pending: 0, leased: 0, deadLetter: 0, providerFailures24h: 0 },
        spend: { status: "configured", configuredCapCount: 1, uncappedConnectionCount: 0 },
        backup: { status: "configured", freshness: "unknown" },
      },
      provisioning: [],
      resources: [],
      requests: [],
      spendAlarms: [],
      blades: { present: true, published: true, serviceStatus: "active", inboundActive: true },
    } });
    if (path === "/api/v1/admin/provider-usage") return route.fulfill({ json: {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-30T23:59:59.999Z",
      totals: { usageMinutes: 12, estimatedCostMinor: 45, currency: "GBP" },
      providers: [],
      clients: [{ clientId: client.id, businessName: client.businessName, provider: "elevenlabs-convai", usageMinutes: 12, estimatedCostMinor: 45 }],
      accountSnapshots: [],
    } });
    if (path.endsWith("/prompt-versions") || path.endsWith("/provisioning")) return route.fulfill({ json: { items: [] } });
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
    if (path === `/api/v1/clients/${client.id}/onboarding`) return route.fulfill({ json: { client, provisioning: null } });
    if (path === `/api/v1/clients/${client.id}/notifications/status`) return route.fulfill({ json: { pending: 0, failed: 0 } });
    if (path === `/api/v1/clients/${client.id}/twilio-connection`) return route.fulfill({ json: { mode: "robinexis_account", status: "active", selectedPhoneNumber: "+441130000000", canReconnect: true } });
    if (path === `/api/v1/clients/${client.id}/calendar-connection`) return route.fulfill({ json: { mode: "managed", status: "active", destinationCalendarId: "calendar_1", availableCalendars: [], canReconnect: true } });
    if (path === "/api/v1/audit" || path === "/api/v1/admin/audit") return route.fulfill({ json: { items: [] } });
    if (path === "/api/v1/memberships") return route.fulfill({ json: { items: role === "salon" ? [{ id: "member_1", clientId: client.id, email: "owner@demo-salon.test", role: "owner", createdAt: "2026-09-01T00:00:00.000Z" }] : [] } });
    if (path === "/api/v1/usage") return route.fulfill({ json: { clientId: client.id, month: "2026-08", inboundMinutes: 10, outboundMinutes: 2 } });
    if (path === "/api/v1/billing/status") return route.fulfill({ json: {
      configured: true,
      canManagePortal: true,
      plan: "starter",
      status: subscriptionStatus,
      trialEndsAt: "2026-09-16T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    } });
    if (path.endsWith("/provider-switch/health")) {
      return route.fulfill({ json: { clientId: client.id, status: "healthy", checks: [], checkedAt: new Date().toISOString() } });
    }
    if (path.endsWith("/provider-switch/prepare")) {
      return route.fulfill({ status: 201, json: {
        deploymentId: "deployment_livekit_staged",
        provider: "livekit-cascade",
        status: "staged",
        preparedAt: new Date().toISOString(),
      } });
    }
    if (path.endsWith("/provider-switch/launch-gate")) {
      if (route.request().method() === "GET") {
        return storedLaunchGate
          ? route.fulfill({ json: storedLaunchGate })
          : route.fulfill({ status: 404, json: { error: "provider_launch_gate_not_found" } });
      }
      const input = route.request().postDataJSON();
      storedLaunchGate = {
        ...input,
        id: "gate_e2e",
        evaluatedAt: new Date().toISOString(),
        evaluatedBy: "operator",
        passed: true,
        checks: [{ key: "barge_in", passed: true, blocking: true, detail: "Candidate barge-in test passed." }],
      };
      return route.fulfill({ status: 201, json: storedLaunchGate });
    }
    if (path.endsWith("/provider-switch/preview")) {
      return route.fulfill({ json: {
        clientId: client.id,
        fromProvider: "elevenlabs-convai",
        toProvider: "livekit-cascade",
        targetDeploymentId: "deployment_livekit_staged",
        status: storedLaunchGate ? "ready" : "blocked",
        featureEnabled: true,
        checks: [{
          key: "quality_launch_gate",
          passed: Boolean(storedLaunchGate),
          blocking: true,
          detail: storedLaunchGate ? "Stored quality gate passed." : "A stored passing quality gate is required.",
        }],
      } });
    }
    if (path === `/api/v1/clients/${client.id}`) return route.fulfill({ json: { ...client, role: "AI receptionist", tone: "Warm and concise", publishedFacts: [], services: [] } });
    if (withOnboarding && path === `/api/v1/clients/${client.id}/onboarding/wizard`) {
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        Object.assign(wizard.data, input.data || {});
        if (input.currentStep) wizard.currentStep = input.currentStep;
        if (input.completedStep && !wizard.completedSteps.includes(input.completedStep)) wizard.completedSteps.push(input.completedStep);
        wizard.version += 1;
      }
      const ready = wizard.currentStep === "review";
      return route.fulfill({ json: {
        client,
        wizard,
        readiness: { ready, blockers: ready ? [] : [{ key: "in_progress", step: wizard.currentStep, message: "Complete this step." }] },
        provisioning: null,
      } });
    }
    if (withOnboarding && path === `/api/v1/clients/${client.id}/website-intelligence`) {
      if (route.request().method() === "POST") {
        Object.assign(wizard.data, { websiteUrl: "https://demo.example", websiteRunId: "run_1" });
        return route.fulfill({ status: 201, json: { run: { id: "run_1", status: "succeeded" }, facts, gaps: [], sources: [] } });
      }
      return route.fulfill({ json: { run: { id: "run_1", status: "succeeded" }, facts, gaps: [], sources: [] } });
    }
    if (withOnboarding && path.includes("/website-intelligence/runs/run_1/facts/")) {
      const fact = facts.find((item) => path.endsWith(item.id))!;
      const input = route.request().postDataJSON();
      fact.reviewStatus = input.action === "edit" ? "edited" : "confirmed";
      return route.fulfill({ json: { fact } });
    }
    if (withOnboarding && path.endsWith("/website-intelligence/runs/run_1/approve-indexing")) {
      return route.fulfill({ json: { approved: true, published: false } });
    }
    if (withOnboarding && path.endsWith("/onboarding/wizard/submit")) {
      lifecycleStatus = "setup_queued";
      return route.fulfill({ status: 202, json: { wizard, onboardingStatus: lifecycleStatus, message: "Queued" } });
    }
    return route.fulfill({ json: { items: [] } });
  });
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    { message: "page should not scroll horizontally" },
  ).toBe(true);
}

test("public pricing explains the product and access model", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: /a receptionist built for you/i })).toBeVisible();
  await expect(page.getByText(/3-day trial/i).first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test("enterprise contact is generic, public, and prospect-safe", async ({ page }) => {
  await page.goto("/enterprise-contact");
  await expect(page.getByRole("heading", { name: /A receptionist built around every location/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Contact sales/i })).toHaveAttribute(
    "href",
    "mailto:hello@robinexis.com?subject=Enterprise%20Robinexis",
  );
  await expect(page.locator("body")).not.toContainText(/Blades Hair/i);
  await expectNoPageOverflow(page);
});

test("public Blades receptionist is branded and needs no login", async ({ page }) => {
  const renderWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Maximum update depth exceeded")) renderWarnings.push(message.text());
  });
  await page.goto("/demo/blades-hair");
  await expect(page.getByRole("heading", { name: /Meet Sophie, the AI receptionist/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Sophie/i })).toBeVisible();
  await expect(page.getByText(/Powered by Robinexis/i).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
  await expect(page.locator('a[href*="elevenlabs.io"]')).toHaveCount(0);
  await expectNoPageOverflow(page);
  expect(renderWarnings).toEqual([]);
});

test("operator can open the data-backed overview", async ({ page }) => {
  await openWorkspaceSession(page);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Demo Salon is in good hands/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("12", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Needs setup").first()).toBeVisible();
  await expect(page.getByText("Recommended next action")).toBeVisible();
  await expect(page.getByText("Recovery metrics")).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test("public and workspace navigation adapt to the viewport", async ({ page }) => {
  await page.goto("/pricing");
  const viewportWidth = page.viewportSize()?.width || 1280;
  const publicMenuButton = page.getByRole("button", { name: "Open menu" });
  if (viewportWidth <= 850) {
    await expect(publicMenuButton).toBeVisible();
    await publicMenuButton.click();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Pricing" })).toBeVisible();
  } else {
    await expect(publicMenuButton).toBeHidden();
  }

  await openWorkspaceSession(page);
  await page.goto("/app");
  const workspaceMenuButton = page.getByRole("button", { name: "Open navigation" });
  if (viewportWidth <= 850) {
    await expect(workspaceMenuButton).toBeVisible();
    await workspaceMenuButton.click();
    await expect(page.getByRole("navigation", { name: "Product navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Close navigation" }).click();
  } else {
    await expect(workspaceMenuButton).toBeHidden();
  }
  await expectNoPageOverflow(page);
});

test("all operator areas render against their backend contracts", async ({ page }) => {
  test.setTimeout(120_000);
  let activePath = "";
  const renderWarnings: Array<{ path: string; text: string }> = [];
  page.on("console", (message) => {
    if (message.text().includes("Maximum update depth exceeded")) {
      renderWarnings.push({ path: activePath, text: message.text() });
    }
  });
  await openWorkspaceSession(page);
  const routes = [
    ["/app/setup", "Know exactly what is ready"],
    ["/app/business", "One source of truth for every call"],
    ["/app/agents", "Your reception team"],
    [`/app/agents/${client.id}`, "AI receptionist"],
    ["/app/playground", "Your receptionist, ready to talk"],
    ["/app/calls", "Every conversation, accounted for"],
    ["/app/analytics", "Know what’s happening on the phone"],
    ["/app/calendar", "Bookings and availability in one view"],
    ["/app/calendar/settings", "Control when and how bookings happen"],
    ["/app/phone", "Ownership, routing and health"],
    ["/app/usage", "Your plan, allowance and voice usage"],
    ["/app/knowledge", "Give your agent the right answers"],
    ["/app/integrations", "Connect the tools behind the conversation"],
    ["/app/team", "The people behind Demo Salon"],
    ["/admin/billing", "A plan that grows with every call"],
    ["/app/settings", "The business behind the voice"],
  ] as const;

  for (const [path, heading] of routes) {
    activePath = path;
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 15_000 });
    await expectNoPageOverflow(page);
  }
  expect(renderWarnings).toEqual([]);
});

test("operator admin is isolated under the admin route", async ({ page }) => {
  await openWorkspaceSession(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Operations dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Operator admin" })).toHaveCount(0);
  await expect(page.getByText("Provisioning queue", { exact: true }).first()).toBeVisible();

  await page.goto("/admin/control-plane");
  await expect(page.getByRole("heading", { name: "Platform control plane" })).toBeVisible();
  await expect(page.getByText("Blades baseline status")).toBeVisible();

  await page.goto("/admin/clients/new");
  await expect(page.getByRole("heading", { name: "Let’s learn the essentials" })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("operator triages requests, replays billing, and adjusts allowance with audit input", async ({ page }) => {
  await openWorkspaceSession(page);
  const actions: string[] = [];
  await page.route("**/api/v1/admin/control-plane", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: {
      generatedAt: "2026-09-16T10:00:00.000Z",
      health: {
        status: "ok",
        notificationQueue: { pending: 0, leased: 0, deadLetter: 0, providerFailures24h: 0 },
        spend: { status: "configured", configuredCapCount: 1, uncappedConnectionCount: 0 },
        backup: { status: "configured", freshness: "recent" },
      },
      provisioning: [], resources: [], spendAlarms: [],
      requests: [{ id: "request_1", clientId: client.id, businessName: client.businessName, type: "support", status: "pending", createdAt: "2026-09-16T09:00:00.000Z" }],
      blades: { present: true, published: true, serviceStatus: "active", inboundActive: true },
    } });
  });
  await page.route("**/api/v1/admin/summary", async (route) => {
    await route.fulfill({ json: {
      month: "2026-09", mrrPence: 9900, totalUsedMinutes: 12, totalFailedCalls: 0, setupQueueCount: 0,
      failedBillingEvents: [{ id: "evt_failed", clientId: client.id, eventType: "invoice.payment_failed", error: "Temporary provider error", receivedAt: "2026-09-16T09:00:00.000Z" }],
      clients: [{ clientId: client.id, plan: "starter", subscriptionStatus: "active", usedMinutes: 12, remainingMinutes: 88, failedCalls: 0 }],
    } });
  });
  await page.route("**/api/v1/admin/requests/*/status", async (route) => {
    actions.push(`request:${route.request().postDataJSON().status}`);
    await route.fulfill({ json: { request: { id: "request_1", status: "in_progress" } } });
  });
  await page.route("**/api/v1/admin/billing-events/*/replay", async (route) => {
    actions.push("billing:replay");
    await route.fulfill({ json: { ok: true, status: "processed" } });
  });
  await page.route("**/api/v1/clients/*/credit-adjustments", async (route) => {
    const body = route.request().postDataJSON();
    actions.push(`credit:${body.minutes}:${body.reason}`);
    await route.fulfill({ json: { appended: true, remainingMinutes: 113 } });
  });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Start" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Replay" }).click();
  await expect.poll(() => actions).toContain("request:in_progress");
  await expect.poll(() => actions).toContain("billing:replay");

  await page.goto(`/admin/customers/${client.id}?adjust=credits`);
  const dialog = page.getByRole("dialog", { name: "Adjust customer allowance" });
  await dialog.getByLabel("Minutes").fill("25");
  await dialog.getByLabel("Audit reason").fill("Customer goodwill");
  await dialog.getByRole("button", { name: "Record adjustment" }).click();
  await expect.poll(() => actions).toContain("credit:25:Customer goodwill");
});

test("operator stores quality evidence before LiveKit preflight", async ({ page }) => {
  await openWorkspaceSession(page);
  const startRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/provider-switch/start")) startRequests.push(request.url());
  });
  await page.goto(`/admin/customers/${client.id}`);
  await page.getByRole("button", { name: "1. Prepare staged deployment" }).click();
  await expect(page.getByText("2. Benchmark launch gate")).toBeVisible();

  const metrics = JSON.stringify({
    totalCostMinor: 7_500,
    successfulBookings: 100,
    bookingAttempts: 125,
    blindVoiceWins: 20,
    blindVoiceTies: 0,
    blindVoiceComparisons: 25,
    p95FirstResponseMs: 500,
    totalCalls: 1_000,
    failedCalls: 20,
    bargeInPassed: true,
  });
  await page.getByLabel("Baseline benchmark JSON").fill(metrics.replace("7500", "10000"));
  await page.getByLabel("Candidate benchmark JSON").fill(metrics);
  await page.getByRole("button", { name: "Evaluate and store gate" }).click();
  await expect(page.getByText("Quality gate passed")).toBeVisible();
  expect(startRequests).toEqual([]);

  await page.getByRole("button", { name: /Run safe-switch preflight/ }).click();
  await expect(page.getByText("Ready to switch")).toBeVisible();
});

test("viewer control planes are read-only on mobile", async ({ page }) => {
  const renderWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Maximum update depth exceeded")) renderWarnings.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspaceSession(page, "salon", "active", "active", false, "website", "viewer");
  await page.goto("/app/business");
  await expect(page.getByText("Viewer access · read only").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByLabel("Business name")).toBeDisabled();
  await expectNoPageOverflow(page);

  await page.goto("/app/setup");
  await expect(page.getByText(/Only the workspace owner can activate/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate receptionist" })).toHaveCount(0);
  expect(renderWarnings).toEqual([]);
});

test("booking workflow exposes filters and details", async ({ page }) => {
  await openWorkspaceSession(page);
  await page.goto("/app/calendar");
  await expect(page.getByPlaceholder("Search customer, email or title…")).toBeVisible();
  await expect(page.getByText("Alex Customer")).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog").getByText("alex@example.test")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("salon owners see only their workspace experience", async ({ page }) => {
  await openWorkspaceSession(page, "salon");
  await page.goto("/app");
  await expect(page.getByText("Salon owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo Salon", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Campaigns" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Plan & usage" })).toHaveAttribute("href", "/app/usage");
  await expect(page.getByRole("link", { name: "Operator admin" })).toHaveCount(0);

  await page.goto("/app/team");
  await expect(page.locator("#main-content").getByText("owner@demo-salon.test", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goto("/app/billing");
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/app$/);
});

test("past-due salon deep links are redirected to billing recovery", async ({ page }) => {
  await openWorkspaceSession(page, "salon", "past_due");

  await page.goto("/app/agents");

  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole("heading", { name: /billing needs attention/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Manage billing in Stripe/i })).toBeVisible();
  await expect(page.getByText(/plan needs attention/i)).toBeVisible();
});

test("customer completes the mocked resumable onboarding flow", async ({ page }) => {
  await openWorkspaceSession(page, "salon", "trialing", "details_required", true);
  await page.goto("/onboarding");

  await expect(page.getByRole("heading", { name: "Start with your website" })).toBeVisible();
  await page.getByLabel("Business website").fill("https://demo.example");
  await page.getByRole("button", { name: /Scan website/ }).click();
  await expect(page.getByRole("heading", { name: "Check what we found" })).toBeVisible();

  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Confirmed" })).toHaveCount(1);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirmed" })).toHaveCount(2);
  await page.getByRole("button", { name: "Approve reviewed facts" }).click();

  await expect(page.getByRole("heading", { name: "Shape every conversation" })).toBeVisible();
  await page.getByLabel("Recording consent").selectOption("always_ask");
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await expect(page.getByRole("heading", { name: "Add services and booking rules" })).toBeVisible();
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await expect(page.getByRole("heading", { name: "Choose your phone route" })).toBeVisible();
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await expect(page.getByRole("heading", { name: "Choose your calendar route" })).toBeVisible();
  await page.getByRole("button", { name: /Save and continue/ }).click();

  await expect(page.getByText("Your brief is ready")).toBeVisible();
  await page.getByRole("button", { name: "Submit for specialist setup" }).click();
  await expect(page.getByRole("heading", { name: "Your setup is in the queue" })).toBeVisible();
  await expect(page.getByText(/approve it before activation/i)).toBeVisible();
  await expectNoPageOverflow(page);
});

test("paid incomplete salon resumes the saved onboarding step", async ({ page }) => {
  await openWorkspaceSession(page, "salon", "active", "details_required", true, "behavior");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding$/);

  await expect(page.getByRole("heading", { name: "Shape every conversation" })).toBeVisible();
  await expect(page.getByText("Step 3 of 7")).toBeVisible();
  await expect(page.getByLabel("Opening greeting")).toHaveValue("Hello, thanks for calling Demo Salon. How can I help?");
  await expect(page.getByLabel("Transfer number")).toHaveValue("+447700900123");
  await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toBeVisible();
  await expectNoPageOverflow(page);
});

test("onboarding recovers instead of crashing on an unusable wizard response", async ({ page }) => {
  await openWorkspaceSession(page, "salon", "active", "details_required");
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "We couldn’t load your setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact setup support" })).toBeVisible();
});

test("submitted salon sees setup queue progress", async ({ page }) => {
  await openWorkspaceSession(page, "salon", "active", "setup_queued");
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: /setup is in the queue/i })).toBeVisible();
  await expect(page.getByText("Brief received")).toBeVisible();
  await expect(page.getByText("Your approval")).toBeVisible();
  await expect(page.getByText(/Required before activation/i)).toBeVisible();
});
