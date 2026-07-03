import { expect, test } from "@playwright/test";

/**
 * The visitor's walk — the demo's reason to exist. A first-time viewer lands on
 * the overview, follows one break the banner points at, and reaches the raw
 * record that break traces back to. Asserting it end to end proves the whole
 * stack agrees: web → API → Postgres, with the money and provenance intact.
 */
test("overview → a break → the raw record it came from", async ({ page }) => {
  await page.goto("/");

  // The first-visit banner states, in plain English, how many things didn't tie.
  await expect(page.getByText(/didn.t tie out/i)).toBeVisible();

  // Follow the hero break the banner points at.
  await page.getByRole("link", { name: /Follow one/i }).click();
  await expect(page).toHaveURL(/\/breaks\/[0-9a-f-]+$/);

  // The headline is the plain-English gloss, and a break wears its type chip.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The evidence bottoms out at the raw record — shown verbatim, content hash and all.
  await expect(page.getByText(/exactly as received/i).first()).toBeVisible();
  await expect(page.getByText(/content hash/i).first()).toBeVisible();
});

/** A run's detail is reachable and states its counters — the auditor's entry point. */
test("a run's detail names its matched and broken counts", async ({ page }) => {
  await page.goto("/runs");
  await page.getByRole("link", { name: /latest/i }).first().click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+/);
  await expect(page.getByText("Matched", { exact: true })).toBeVisible();
  await expect(page.getByText("Breaks", { exact: true }).first()).toBeVisible();
});
