import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`public pricing has no serious accessibility violations on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /receptionist built for you/i })).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""))).toEqual([]);
  });
}
