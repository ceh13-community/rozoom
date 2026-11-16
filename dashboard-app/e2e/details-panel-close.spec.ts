import { expect, test, type Page } from "@playwright/test";

const CLUSTER_ID = "dev";
const ROW_NAME = "payments-api-764bb667b8";
const DEPLOYMENT_NAME = "payments-api";
const CONFIGMAP_NAME = "payments-config";

function cacheKeys(workload: string) {
  return ["none", "name"].map(
    (sort) =>
      `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::${workload}::all::${sort}`)}`,
  );
}

async function openWorkloadWithCachedRows(
  page: Page,
  workload: string,
  rows: unknown[],
  rowName: string,
) {
  const snapshot = JSON.stringify({ schemaVersion: 1, cachedAt: Date.now(), data: rows });
  await page.addInitScript(
    ([keys, value]) => {
      (
        window as typeof window & {
          __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
        }
      ).__TAURI_INTERNALS__ = {
        // Keep background refresh pending so the cached rows stay on screen.
        invoke: async () => await new Promise<never>(() => {}),
      };
      for (const key of keys) window.localStorage.setItem(key, value);
    },
    [cacheKeys(workload), snapshot] as const,
  );
  await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=${workload}`);
  await page.locator(".splash").waitFor({ state: "detached", timeout: 10_000 });
  await expect(page.getByText(rowName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function openReplicaSetsWithCachedRow(page: Page) {
  await openWorkloadWithCachedRows(
    page,
    "replicasets",
    [
      {
        metadata: {
          uid: "rs-1",
          name: ROW_NAME,
          namespace: "demo-video",
          creationTimestamp: new Date().toISOString(),
          ownerReferences: [{ kind: "Deployment", name: "payments-api", controller: true }],
        },
        spec: { replicas: 2 },
        status: { replicas: 1, readyReplicas: 0 },
      },
    ],
    ROW_NAME,
  );
}

async function rowAction(page: Page, rowName: string, action: string) {
  await page
    .getByRole("button", { name: `Open actions for ${rowName}` })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}

function panelClosedBy(page: Page, closeLabel: string) {
  return page.locator("aside", { has: page.getByRole("button", { name: closeLabel }) });
}

function detailsPanel(page: Page) {
  return page.locator("aside", { hasText: `Replica Set: ${ROW_NAME}` });
}

async function openDetails(page: Page) {
  await rowAction(page, ROW_NAME, "Show details");
  const panel = detailsPanel(page);
  await expect(panel).toBeVisible();
  return panel;
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
]) {
  test(`details panel closes by X and by Escape at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openReplicaSetsWithCachedRow(page);

    const panel = await openDetails(page);
    const close = panel.getByRole("button", { name: "Close replica set details" });
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await close.click();
    await expect(panel).toHaveCount(0);

    await openDetails(page);
    await page.keyboard.press("Escape");
    await expect(detailsPanel(page)).toHaveCount(0);
  });
}

test("one Escape closes the details panel and leaves the workbench tab under it", async ({
  page,
}) => {
  await openWorkloadWithCachedRows(
    page,
    "deployments",
    [
      {
        metadata: {
          uid: "deploy-1",
          name: DEPLOYMENT_NAME,
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          resourceVersion: "100",
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: DEPLOYMENT_NAME } },
          template: {
            metadata: { labels: { app: DEPLOYMENT_NAME } },
            spec: { containers: [{ name: "main", image: "nginx:stable" }] },
          },
        },
        status: { readyReplicas: 1, updatedReplicas: 1, availableReplicas: 1, replicas: 1 },
      },
    ],
    DEPLOYMENT_NAME,
  );

  // Closing a YAML tab asks first. Outside the desktop shell that question
  // is window.confirm, so a second handler acting on the same Escape shows
  // up here as a dialog.
  const closeTabPrompts: string[] = [];
  page.on("dialog", (dialog) => {
    closeTabPrompts.push(dialog.message());
    void dialog.dismiss();
  });

  // A YAML tab in the workbench below the list.
  await rowAction(page, DEPLOYMENT_NAME, "Edit YAML");
  const workbenchTabs = page.getByRole("button", { name: /^Close .+ tab$/ });
  await expect(workbenchTabs).toHaveCount(1);

  await rowAction(page, DEPLOYMENT_NAME, "Show details");
  const panel = panelClosedBy(page, "Close details");
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Give a stray second handler time to reach the prompt.
  await page.waitForTimeout(300);
  expect(closeTabPrompts).toEqual([]);
  await expect(workbenchTabs).toHaveCount(1);
});

test("Escape in the data key search leaves the field and keeps the panel open", async ({
  page,
}) => {
  await openWorkloadWithCachedRows(
    page,
    "configmaps",
    [
      {
        metadata: {
          uid: "cm-1",
          name: CONFIGMAP_NAME,
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          resourceVersion: "100",
        },
        data: { "app.yaml": "replicas: 1", "feature.flags": "beta=true" },
      },
    ],
    CONFIGMAP_NAME,
  );

  await rowAction(page, CONFIGMAP_NAME, "Show details");
  const panel = page.locator("aside", { has: page.getByPlaceholder("Search data keys...") });
  await expect(panel).toBeVisible();

  const search = panel.getByPlaceholder("Search data keys...");
  await search.fill("app");
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue("app");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
