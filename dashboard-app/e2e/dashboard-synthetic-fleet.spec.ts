import { expect, test } from "@playwright/test";

test.describe("dashboard synthetic fleet harness", () => {
  for (const fleetSize of [50, 100]) {
    test(`renders ${fleetSize} synthetic cluster cards`, async ({ page }) => {
      await page.goto(`/dashboard?syntheticFleet=${fleetSize}`);

      await expect(
        page.getByRole("heading", { name: "Available Kubernetes Clusters" }),
      ).toBeVisible();
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText(
        `Stress view for ${fleetSize} cards.`,
      );
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText("Top slow cards");
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText("Run auto stress");
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText("Last stress run");
      await expect(page.getByLabel("Synthetic stress preset")).toBeVisible();
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText("Preset verdicts");
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText("Comparison history");
      await expect(page.getByTestId("synthetic-fleet-panel")).toContainText(
        "Recent comparison runs",
      );
      await expect(page.getByText("Synthetic Fleet 001")).toBeVisible();
      // Virtual grid renders only visible cards - verify at least some render
      const cardCount = await page.locator('[data-testid="cluster-card"]').count();
      expect(cardCount).toBeGreaterThan(0);
    });
  }
});
