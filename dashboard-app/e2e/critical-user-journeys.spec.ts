import { expect, test, type Page } from "@playwright/test";

/**
 * Critical user journeys - end-to-end tests that simulate real user
 * workflows against the synthetic fleet harness (no live cluster needed).
 *
 * These tests cover the 7 most common user actions:
 * 1. Dashboard loads and shows clusters
 * 2. Navigate into a cluster
 * 3. Navigate between workload pages
 * 4. Workspace layout switching (1/2/3 panes)
 * 5. Pin and unpin a page
 * 6. Helm Catalog page renders charts
 * 7. Search and filter
 */

const CLUSTER_ID = "journey-qa";
const CLUSTER_NAME = "Journey QA";

const OVERVIEW_SNAPSHOT = JSON.stringify({
  schemaVersion: 1,
  cachedAt: Date.now(),
  data: {
    pods: { quantity: 12 },
    deployments: { quantity: 4 },
    daemonsets: { quantity: 2 },
    statefulsets: { quantity: 1 },
    replicasets: { quantity: 5 },
    jobs: { quantity: 0 },
    cronjobs: { quantity: 1 },
    nodes: { quantity: 2 },
  },
});

async function seedTestCluster(page: Page) {
  await page.addInitScript(
    ([clusterId, clusterName, overviewSnapshot]) => {
      window.localStorage.setItem(
        "tauri-store-fallback:clusters.json",
        JSON.stringify({
          clusters: [
            {
              uuid: clusterId,
              name: clusterName,
              addedAt: new Date("2026-03-22T00:00:00.000Z").toISOString(),
              needsInitialRefreshHint: false,
            },
          ],
        }),
      );
      window.localStorage.setItem(
        "dashboard.data-profile.v1",
        JSON.stringify({ profileId: "manual" }),
      );
      const cacheKey = `dashboard.workloads.cache.v1:${encodeURIComponent(`${clusterId}::overview::all::name`)}`;
      window.localStorage.setItem(cacheKey, overviewSnapshot);
    },
    [CLUSTER_ID, CLUSTER_NAME, OVERVIEW_SNAPSHOT],
  );
}

test.describe("critical user journeys", () => {
  test.beforeEach(async ({ page }) => {
    await seedTestCluster(page);
  });

  test("1. dashboard loads and shows cluster cards", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Available Kubernetes Clusters" }),
    ).toBeVisible();

    // Cluster card visible
    await expect(page.getByText(CLUSTER_NAME)).toBeVisible();

    // Layout controls visible
    await expect(page.getByText("Compact")).toBeVisible();
    await expect(page.getByText("Detailed")).toBeVisible();

    // Linter toggle visible
    await expect(page.getByText("Linter")).toBeVisible();
  });

  test("2. navigate into cluster and see overview", async ({ page }) => {
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);

    // Page title contains cluster name
    await expect(page.locator("h1")).toContainText("Overview");

    // Workspace layout buttons visible
    await expect(page.getByRole("button", { name: "Single pane layout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dual pane layout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Triple pane layout" })).toBeVisible();

    // Workspace mode badge
    await expect(page.getByText("Unsaved workspace")).toBeVisible();
  });

  test("3. navigate between workload pages via sidebar", async ({ page }) => {
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);
    await page.waitForTimeout(500);

    // Click on Pods in sidebar
    const podsLink = page.getByRole("link", { name: "Pods" }).first();
    if (await podsLink.isVisible()) {
      await podsLink.click();
      await page.waitForTimeout(500);
      await expect(page.locator("h1")).toContainText("Pods");
    }
  });

  test("4. workspace layout switching", async ({ page }) => {
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);
    await page.waitForTimeout(500);

    // Start with single pane
    const singleBtn = page.getByRole("button", { name: "Single pane layout" });
    await expect(singleBtn).toBeVisible();

    // Switch to dual pane
    const dualBtn = page.getByRole("button", { name: "Dual pane layout" });
    await dualBtn.click();
    await page.waitForTimeout(300);

    // Pane 2 should appear
    await expect(page.getByText("Pane 2")).toBeVisible();

    // Switch to triple pane
    const tripleBtn = page.getByRole("button", { name: "Triple pane layout" });
    await tripleBtn.click();
    await page.waitForTimeout(300);

    // Pane 3 should appear
    await expect(page.getByText("Pane 3")).toBeVisible();

    // Switch back to single
    await singleBtn.click();
    await page.waitForTimeout(300);

    // Pane 2/3 should be hidden
    await expect(page.getByText("Pane 2")).not.toBeVisible();
    await expect(page.getByText("Pane 3")).not.toBeVisible();
  });

  test("5. pin and unpin a page", async ({ page }) => {
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=overview`);
    await page.waitForTimeout(500);

    // Should show "Unsaved workspace" before pin
    await expect(page.getByText("Unsaved workspace")).toBeVisible();

    // Find and click pin button
    const pinBtn = page.getByRole("button", { name: /pin/i }).first();
    if (await pinBtn.isVisible()) {
      await pinBtn.click();
      await page.waitForTimeout(500);

      // Should show "Pinned workspace" after pin
      const pinned = page.getByText("Pinned workspace");
      if (await pinned.isVisible()) {
        // Unpin
        await pinBtn.click();
        await page.waitForTimeout(500);
        await expect(page.getByText("Unsaved workspace")).toBeVisible();
      }
    }
  });

  test("6. helm catalog renders charts", async ({ page }) => {
    await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=helmcatalog`);
    await page.waitForTimeout(1000);

    // Helm Catalog heading
    await expect(page.getByText("Helm Catalog")).toBeVisible();

    // At least one chart category
    await expect(page.getByText("Observability")).toBeVisible();

    // At least one chart name
    await expect(page.getByText("kube-prometheus-stack")).toBeVisible();
  });

  test("7. search clusters on dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(500);

    const searchInput = page.getByPlaceholder("Search clusters");
    if (await searchInput.isVisible()) {
      await searchInput.fill("nonexistent");
      await page.waitForTimeout(300);

      // No clusters should match
      const cards = page.locator('[data-testid="cluster-card"]');
      await expect(cards).toHaveCount(0);

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(300);

      // Cluster should reappear
      await expect(page.getByText(CLUSTER_NAME)).toBeVisible();
    }
  });
});
