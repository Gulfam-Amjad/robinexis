import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/plans", (route) => route.fulfill({
    json: {
      currency: "GBP",
      items: [
        {
          tier: "starter",
          name: "Starter",
          monthlyPricePence: 9900,
          trialDays: 3,
          calendarLimit: 1,
          locationLimit: 1,
          includedMinutes: 300,
          includedMessages: 0,
          phoneProvisioning: { customerOwned: true, managed: false, monthlySpendCapPence: 0 },
          features: [],
        },
        {
          tier: "pro",
          name: "Pro",
          monthlyPricePence: 19900,
          trialDays: 3,
          calendarLimit: 5,
          locationLimit: 1,
          includedMinutes: 1500,
          includedMessages: 3000,
          phoneProvisioning: { customerOwned: true, managed: false, monthlySpendCapPence: 0 },
          features: [],
        },
        {
          tier: "enterprise",
          name: "Enterprise",
          monthlyPricePence: null,
          trialDays: 3,
          calendarLimit: null,
          locationLimit: null,
          includedMinutes: 5000,
          includedMessages: 0,
          phoneProvisioning: { customerOwned: true, managed: false, monthlySpendCapPence: 0 },
          features: [],
        },
      ],
    },
  }));
});

test("publishes the £199 Pro price and complete legal footer", async ({ page }) => {
  await page.goto("/pricing");
  const pro = page.getByRole("heading", { name: "Pro" }).locator("..");
  await expect(pro).toContainText("£199");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy-policy");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms-and-conditions");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Cookies" })).toHaveAttribute("href", "/cookie-policy");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "DPA" })).toHaveAttribute("href", "/data-processing-agreement");
});

for (const [path, heading] of [
  ["/privacy-policy", "Privacy Policy"],
  ["/terms-and-conditions", "Terms & Conditions"],
  ["/gdpr-data-protection", "GDPR & Data Protection"],
  ["/cookie-policy", "Cookie Policy"],
  ["/data-processing-agreement", "Data Processing Agreement"],
] as const) {
  test(`${path} publishes the registered company details`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText("Company number 16468366")).toBeVisible();
    await expect(page.getByText(/71-75 Shelton Street/)).toBeVisible();
    await expect(page.getByText("Draft for solicitor review")).toHaveCount(0);
  });
}

test("uses the published privacy and general contact addresses", async ({ page }) => {
  await page.goto("/privacy-policy");
  await expect(page.getByRole("link", { name: "privacy@robinexis.com" })).toHaveAttribute("href", "mailto:privacy@robinexis.com");
  await page.goto("/terms-and-conditions");
  await expect(page.getByRole("link", { name: "info@robinexis.com" })).toHaveAttribute("href", "mailto:info@robinexis.com");
});
