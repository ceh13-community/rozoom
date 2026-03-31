import { expect, test } from "@playwright/test";

/**
 * Visual regression tests capture screenshots of key pages and compare
 * against baseline images. Run `npx playwright test --update-snapshots`
 * to update baselines after intentional UI changes.
 */

const CLUSTER_ID = "visual-qa";
const CLUSTER_NAME = "QA Cluster";

function seedCluster(clusterId: string, clusterName: string) {
  return ([id, name]: [string, string]) => {
    const clusterStoreKey = "tauri-store-fallback:clusters.json";
    window.localStorage.setItem(
      clusterStoreKey,
      JSON.stringify({
        clusters: [
          {
            uuid: id,
            name: name,
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
  };
}

test.describe("visual regression - dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedCluster, [CLUSTER_ID, CLUSTER_NAME]);
  });

  test("dashboard page renders cluster cards", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Available Kubernetes Clusters" }),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("dashboard-clusters.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("cluster manager page renders", async ({ page }) => {
    await page.goto("/cluster-manager");
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("cluster-manager.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe("visual regression - cluster pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedCluster, [CLUSTER_ID, CLUSTER_NAME]);
  });

  const pages = [
    { workload: "overview", name: "overview" },
    { workload: "pods", name: "pods" },
    { workload: "deployments", name: "deployments" },
    { workload: "helmcatalog", name: "helm-catalog" },
    { workload: "metricssources", name: "metrics-sources" },
    { workload: "nodesstatus", name: "nodes" },
  ];

  for (const p of pages) {
    test(`cluster ${p.name} page renders`, async ({ page }) => {
      await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${p.workload}`);
      await page.waitForTimeout(1500);
      await expect(page).toHaveScreenshot(`cluster-${p.name}.png`, {
        maxDiffPixelRatio: 0.05,
      });
    });
  }
});
