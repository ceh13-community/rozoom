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
    // The seeded cluster has no live agent, so the overview renders the cold
    // state ("Unknown" health, paused metrics). A healthy-with-workloads
    // baseline is a separate snapshot planned for the next sprint.
    { workload: "overview", name: "overview-cold-state" },
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

test.describe("visual regression - connect cluster wizard", () => {
  // No seeded clusters: the wizard <details> auto-expands when the cluster
  // list is empty, which is the first-run experience we want to pin.
  test("wizard auto-expands when no clusters exist", async ({ page }) => {
    await page.goto("/cluster-manager");
    // Wait for hydration first (the splash mounts with the layout); checking
    // for splash absence straight after goto races against it appearing.
    await expect(page.getByRole("heading", { name: "Connect Cluster" })).toBeVisible();
    // The boot splash overlays the page for ~3.6s; with animations disabled it
    // freezes into a "stable" frame, so wait it out before capturing.
    await page.locator(".splash").waitFor({ state: "detached", timeout: 10_000 });
    // The wizard sits below the cluster grid, outside the initial viewport, so
    // capture the expanded <details> element rather than the full page.
    const wizard = page.locator("details").filter({ hasText: "Connect Cluster" }).first();
    await wizard.scrollIntoViewIfNeeded();
    await expect(wizard).toHaveAttribute("open", "");
    await page.waitForTimeout(500);
    await expect(wizard).toHaveScreenshot("connect-wizard-open.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe("visual regression - delete confirm dialog", () => {
  // /dev/ui-catalog is unlocked by PUBLIC_APP_ENV=staging (see
  // playwright.config.ts webServer command) and renders the shared
  // delete-confirm-dialog with fixed demo targets.
  test("delete confirmation dialog renders command preview", async ({ page }) => {
    await page.goto("/dev/ui-catalog");
    await page.getByRole("button", { name: /Delete pod/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    await expect(dialog).toHaveScreenshot("delete-confirm-dialog.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
