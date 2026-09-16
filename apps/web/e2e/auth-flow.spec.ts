import { expect, test, type Page } from "@playwright/test";

const authStorageKey = "sb-test-auth-token";

async function seedSupabaseSession(
  page: Page,
  role: "operator" | "salon" | "pending",
  subscriptionStatus?: "trialing" | "active" | "past_due" | "incomplete",
  onCheckout?: (plan: string) => void,
) {
  const status = subscriptionStatus ?? (role === "salon" ? "trialing" : undefined);
  await page.addInitScript(({ key }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(key, JSON.stringify({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "test-user",
        aud: "authenticated",
        role: "authenticated",
        email: "test@robinexis.test",
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    }));
  }, { key: authStorageKey });

  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") {
      return route.fulfill({ json: {
        email: "test@robinexis.test",
        role,
        clientRoles: role === "salon" ? { client_demo: "owner" } : {},
        capabilities: {
          administerPlatform: role === "operator",
          createClients: role === "operator",
        },
        clientId: role === "salon" ? "client_demo" : undefined,
        subscriptionStatus: status,
      } });
    }
    if (path === "/api/v1/clients") {
      return route.fulfill({ json: { items: role === "pending" ? [] : [{
        id: "client_demo",
        slug: "demo",
        businessName: "Demo Salon",
        published: true,
        serviceStatus: status || "trialing",
      }] } });
    }
    if (path === "/api/v1/admin/summary") {
      return route.fulfill({ json: { mrrPence: 0, totalUsedMinutes: 0, totalFailedCalls: 0, clients: [] } });
    }
    if (path === "/api/v1/admin/control-plane") {
      return route.fulfill({ json: {
        generatedAt: "2026-09-16T00:00:00.000Z",
        health: {
          status: "ok",
          notificationQueue: { pending: 0, leased: 0, deadLetter: 0, providerFailures24h: 0 },
          spend: { status: "configured", configuredCapCount: 0, uncappedConnectionCount: 0 },
          backup: { status: "not_configured", freshness: "unknown" },
        },
        provisioning: [],
        resources: [],
        requests: [],
        spendAlarms: [],
        blades: { present: true, published: true, serviceStatus: "active", inboundActive: true },
      } });
    }
    if (path === "/api/v1/billing/checkout") {
      const body = route.request().postDataJSON() as { plan?: string };
      onCheckout?.(body.plan || "");
      return route.fulfill({ status: 201, json: { checkoutSessionId: "cs_test_pro", url: null } });
    }
    if (path === "/api/v1/billing/status") {
      return route.fulfill({ json: {
        configured: false,
        canManagePortal: false,
        plan: "starter",
        status: status || "incomplete",
      } });
    }
    if (path === "/api/v1/bootstrap") {
      return route.fulfill({ json: {
        clients: [{ id: "client_demo", slug: "demo", businessName: "Demo Salon", published: true, serviceStatus: "trialing" }],
        client: { id: "client_demo", slug: "demo", businessName: "Demo Salon", published: true, serviceStatus: "trialing" },
        recentCalls: [],
        integrations: [],
      } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  });
}

test("logged-out users cannot open the dashboard directly", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
});

test("signup validates and displays the Framer plan query", async ({ page }) => {
  await page.goto("/signup?plan=starter");
  await expect(page.getByText("Starter plan selected")).toBeVisible();
  await page.goto("/signup?plan=pro");
  await expect(page.getByText("Pro plan selected")).toBeVisible();
  await page.goto("/signup?plan=unknown");
  await expect(page.getByText("Choose a plan later")).toBeVisible();
});

test("a selected Pro plan is carried into Stripe checkout", async ({ page }) => {
  let checkoutPlan = "";
  await page.addInitScript(() => {
    localStorage.setItem("robinexis_selected_plan", "pro");
  });
  await seedSupabaseSession(page, "pending", undefined, (plan) => {
    checkoutPlan = plan;
  });

  await page.goto("/billing?plan=pro&startCheckout=1");

  await expect.poll(() => checkoutPlan).toBe("pro");
  await expect(page.getByRole("alert")).toContainText("Stripe Checkout did not return a redirect URL");
});

test("dashboard routes admins to the operator shell", async ({ page }) => {
  await seedSupabaseSession(page, "operator");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Operations dashboard" })).toBeVisible();
});

test("dashboard routes assigned clients to their workspace shell", async ({ page }) => {
  await seedSupabaseSession(page, "salon");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("Demo Salon", { exact: true }).first()).toBeVisible();
});

test("pending signup is sent to checkout until a plan is active", async ({ page }) => {
  await seedSupabaseSession(page, "pending");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole("heading", { name: "Choose a plan to continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Starter/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose a plan to continue" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/billing$/);
});

test("unpaid salon workspaces are sent to checkout, not the dashboard", async ({ page }) => {
  await seedSupabaseSession(page, "salon", "past_due");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole("heading", { name: "Choose a plan to continue" })).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/billing$/);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/billing$/);
});

test("callback errors return a recoverable login action", async ({ page }) => {
  await page.goto("/auth/callback?error_description=Access%20denied");
  await expect(page.getByRole("heading", { name: "Sign-in needs attention" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to login" })).toBeVisible();
});

test("callback exchanges a fresh code even when an older session exists", async ({ page }) => {
  await page.addInitScript(({ key }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(key, JSON.stringify({
      access_token: "stale-access-token",
      refresh_token: "stale-refresh-token",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "stale-user",
        aud: "authenticated",
        role: "authenticated",
        email: "stale@example.test",
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    }));
    localStorage.setItem(`${key}-code-verifier`, JSON.stringify("test-code-verifier"));
  }, { key: authStorageKey });

  await page.route("https://test.supabase.co/auth/v1/token**", (route) => route.fulfill({
    json: {
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "fresh-user",
        aud: "authenticated",
        role: "authenticated",
        email: "operator@example.test",
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    },
  }));
  let freshTokenVerified = false;
  await page.route("**/api/v1/session", async (route) => {
    const authorization = route.request().headers().authorization;
    if (authorization === "Bearer stale-access-token") {
      await route.fulfill({ status: 401, json: { error: "unauthorized" } });
      return;
    }
    expect(authorization).toBe("Bearer fresh-access-token");
    freshTokenVerified = true;
    await route.fulfill({ json: {
      email: "operator@example.test",
      role: "operator",
      clientRoles: {},
      capabilities: { administerPlatform: true, createClients: true },
    } });
  });
  await page.route("**/api/v1/admin/summary", (route) => route.fulfill({
    json: { mrrPence: 0, totalUsedMinutes: 0, totalFailedCalls: 0, clients: [] },
  }));
  await page.route("**/api/v1/clients", (route) => route.fulfill({ json: { items: [] } }));

  await page.goto("/auth/callback?code=fresh-code");

  await expect(page).toHaveURL(/\/admin$/);
  expect(freshTokenVerified).toBe(true);
});
