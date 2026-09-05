import { expect, test, type Page } from "@playwright/test";

const authStorageKey = "sb-test-auth-token";

async function seedSupabaseSession(page: Page, role: "operator" | "salon" | "pending") {
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
      } });
    }
    if (path === "/api/v1/clients") {
      return route.fulfill({ json: { items: role === "pending" ? [] : [{
        id: "client_demo",
        slug: "demo",
        businessName: "Demo Salon",
        published: true,
        serviceStatus: "trialing",
      }] } });
    }
    if (path === "/api/v1/admin/summary") {
      return route.fulfill({ json: { mrrPence: 0, totalUsedMinutes: 0, totalFailedCalls: 0, clients: [] } });
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
  await page.goto("/signup?plan=unknown");
  await expect(page.getByText("Choose a plan later")).toBeVisible();
});

test("dashboard routes admins to the operator shell", async ({ page }) => {
  await seedSupabaseSession(page, "operator");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "One place to run every client workspace" })).toBeVisible();
});

test("dashboard routes assigned clients to their workspace shell", async ({ page }) => {
  await seedSupabaseSession(page, "salon");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("Demo Salon", { exact: true }).first()).toBeVisible();
});

test("pending signup remains signed in on refresh without tenant access", async ({ page }) => {
  await seedSupabaseSession(page, "pending");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("callback errors return a recoverable login action", async ({ page }) => {
  await page.goto("/auth/callback?error_description=Access%20denied");
  await expect(page.getByRole("heading", { name: "Sign-in needs attention" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to login" })).toBeVisible();
});
