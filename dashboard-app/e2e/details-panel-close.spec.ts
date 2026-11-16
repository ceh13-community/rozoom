import { expect, test, type Page } from "@playwright/test";

const CLUSTER_ID = "dev";
const ROW_NAME = "payments-api-764bb667b8";

async function openReplicaSetsWithCachedRow(page: Page) {
  const snapshot = JSON.stringify({
    schemaVersion: 1,
    cachedAt: Date.now(),
    data: [
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
  });
  const keys = ["none", "name"].map(
    (sort) =>
      `dashboard.workloads.cache.v1:${encodeURIComponent(`${CLUSTER_ID}::replicasets::all::${sort}`)}`,
  );
  await page.addInitScript(
    ([cacheKeys, value]) => {
      (
        window as typeof window & {
          __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
        }
      ).__TAURI_INTERNALS__ = {
        // Keep background refresh pending so the cached rows stay on screen.
        invoke: async () => await new Promise<never>(() => {}),
      };
      for (const key of cacheKeys) window.localStorage.setItem(key, value);
    },
    [keys, snapshot] as const,
  );
  await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=replicasets`);
  await page.locator(".splash").waitFor({ state: "detached", timeout: 10_000 });
  await expect(page.getByText(ROW_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
}

function detailsPanel(page: Page) {
  return page.locator("aside", { hasText: `Replica Set: ${ROW_NAME}` });
}

async function openDetails(page: Page) {
  await page
    .getByRole("button", { name: `Open actions for ${ROW_NAME}` })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Show details" }).click();
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
