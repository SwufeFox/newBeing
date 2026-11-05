import { expect, test } from "@playwright/test";
import { setTrainingWorkspace } from "./replay-api.js";

test("AI briefing identifies a failed quote refresh and clears the warning on recovery", async ({ page, request }) => {
  await setTrainingWorkspace(request);
  let failSummary = false;
  let missingTimestamp = false;
  await page.route("**/api/market?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("kind") === "summary" && failSummary) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else if (url.searchParams.get("kind") === "summary" && missingTimestamp) {
      const response = await route.fetch();
      const summary = await response.json() as Record<string, unknown>;
      await route.fulfill({ response, json: { ...summary, timestamp: null } });
    } else {
      await route.continue();
    }
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("tab", { name: "AI context", exact: true }).click();
  const panel = page.locator(".context-panel");
  await expect(panel.getByText(/Quote time \(UTC\):/)).toBeVisible();
  failSummary = true;
  await expect(panel.getByText("STALE · LAST UPDATE FAILED")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/Quote time \(UTC\):/)).toBeVisible();
  await panel.getByRole("button", { name: "Copy Tactical Briefing" }).click();
  const stale = await page.evaluate(() => navigator.clipboard.readText());
  expect(stale).toContain("Latest Price (STALE; last refresh failed):");
  expect(stale).toMatch(/Quote time \(UTC\): \d{4}-\d\d-\d\dT/);
  missingTimestamp = true;
  failSummary = false;
  await expect(panel.getByText("STALE · LAST UPDATE FAILED")).toHaveCount(0, { timeout: 20_000 });
  await expect(panel.getByText("Quote time (UTC): unavailable")).toBeVisible();
  await panel.getByRole("button", { name: /Copy Tactical Briefing|Copied Briefing to Clipboard/ }).click();
  const recovered = await page.evaluate(() => navigator.clipboard.readText());
  expect(recovered).toContain("Latest Price:");
  expect(recovered).toContain("Quote time (UTC): unavailable");
  expect(recovered).not.toContain("STALE");
});
