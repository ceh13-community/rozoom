import { expect, test } from "@playwright/test";

test.describe("fleet optimization features", () => {
  test("synthetic fleet renders collapsible Fleet Control Plane with drift panel", async ({
    page,
  }) => {
    await page.goto("/dashboard?syntheticFleet=50");

    await expect(
      page.getByRole("heading", { name: "Available Kubernetes Clusters" }),
    ).toBeVisible();

    // Fleet Control Plane should be a collapsible details element
    const controlPlane = page
      .locator("details:has(summary:has-text('Fleet Control Plane'))")
      .first();
    await expect(controlPlane).toBeVisible();

    // Should be collapsed by default - cluster cards should be visible without scrolling
    const searchInput = page.getByPlaceholder("Search clusters...");
    await expect(searchInput).toBeVisible();

    // Expand Fleet Control Plane
    await controlPlane.locator("summary").first().click();

    // Should show Fleet Settings panel
    await expect(page.getByText("Fleet Settings")).toBeVisible();
    await expect(page.getByText("Runtime Health")).toBeVisible();
    await expect(page.getByText("Fleet Drift Detector")).toBeVisible();

    // Dashboard profile selector should be visible
    await expect(page.getByLabel("Dashboard profile")).toBeVisible();

    // Drift Detector auto-computes - should show alignment status
    await expect(
      page
        .locator("section:has-text('Fleet Drift Detector')")
        .getByText(/aligned|drift/)
        .first(),
    ).toBeVisible();
  });

  test("synthetic fleet cards have Infrastructure section with lazy load", async ({ page }) => {
    await page.goto("/dashboard?syntheticFleet=50");

    // Enable Linter and switch to Detailed card mode
    await page.getByRole("button", { name: "Linter", exact: true }).click();
    await page.getByText("Detailed", { exact: true }).click();

    await expect(page.locator('[data-testid="cluster-card"]').first()).toBeVisible();

    // Each card should have Infrastructure section
    const firstCard = page.locator('[data-testid="cluster-card"]').first();

    // Open Infrastructure details
    const infraSection = firstCard.locator("details:has(summary:has-text('Infrastructure'))");
    await expect(infraSection).toBeVisible();
    await infraSection.locator("summary").click();

    // Should show infrastructure indicators with Unknown status (synthetic data)
    await expect(infraSection.getByText("Ingress:")).toBeVisible();
    await expect(infraSection.getByText("Storage:")).toBeVisible();
    await expect(infraSection.getByText("RBAC:")).toBeVisible();
  });

  test("synthetic fleet cards have Configuration check with Load diagnostics button", async ({
    page,
  }) => {
    await page.goto("/dashboard?syntheticFleet=50");

    // Enable Linter and switch to Detailed card mode
    await page.getByRole("button", { name: "Linter", exact: true }).click();
    await page.getByText("Detailed", { exact: true }).click();

    const firstCard = page.locator('[data-testid="cluster-card"]').first();

    // Open Configuration check details
    const configSection = firstCard.locator("details:has(summary:has-text('Configuration check'))");
    await expect(configSection).toBeVisible();
    await configSection.locator("summary").click();

    // Should show config diagnostics indicators
    await expect(configSection.getByText("Resources hygiene:")).toBeVisible();
  });

  test("synthetic fleet cards have Health checks section", async ({ page }) => {
    await page.goto("/dashboard?syntheticFleet=50");

    // Enable Linter and switch to Detailed card mode
    await page.getByRole("button", { name: "Linter", exact: true }).click();
    await page.getByText("Detailed", { exact: true }).click();

    const firstCard = page.locator('[data-testid="cluster-card"]').first();

    // Open Health checks details
    const healthSection = firstCard.locator("details:has(summary:has-text('Health checks'))");
    await expect(healthSection).toBeVisible();
    await healthSection.locator("summary").click();

    // Should show health check indicators
    await expect(healthSection.getByText("Pod restarts")).toBeVisible();
  });

  test("drift detector auto-computes on load", async ({ page }) => {
    await page.goto("/dashboard?syntheticFleet=50");

    // Expand Fleet Control Plane
    await page
      .locator("details:has(summary:has-text('Fleet Control Plane'))")
      .first()
      .locator("summary")
      .first()
      .click();

    const driftPanel = page.locator("section:has-text('Fleet Drift Detector')");
    await expect(driftPanel).toBeVisible();

    // Auto-recompute should populate drift state without manual button
    await expect(driftPanel.getByText(/aligned|drift/).first()).toBeVisible();
  });

  test("search filters cluster cards", async ({ page }) => {
    await page.goto("/dashboard?syntheticFleet=50");

    // Virtual grid renders subset of 50 cards - at least some should be visible
    await expect(page.locator('[data-testid="cluster-card"]').first()).toBeVisible();
    const initialCount = await page.locator('[data-testid="cluster-card"]').count();
    expect(initialCount).toBeGreaterThan(0);

    // Search for specific card
    await page.getByPlaceholder("Search clusters...").fill("Synthetic Fleet 001");

    // Should filter to matching card
    await expect(page.locator('[data-testid="cluster-card"]')).toHaveCount(1);

    // Clear search
    await page.getByPlaceholder("Search clusters...").fill("");
    const afterClearCount = await page.locator('[data-testid="cluster-card"]').count();
    expect(afterClearCount).toBeGreaterThan(0);
  });
});
