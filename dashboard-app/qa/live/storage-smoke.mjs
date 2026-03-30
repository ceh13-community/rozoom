/* global console, process, setTimeout */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.LIVE_QA_BASE_URL ?? "http://127.0.0.1:1420";
const CLUSTER_ID = process.env.LIVE_QA_CLUSTER_ID ?? "c595d4b2-20a4-4fe9-b254-5300130893ae";
const FIXTURE_PATH = "./qa/fixtures/live-workloads.yaml";
const QA_NAMESPACE = "qa-workloads";
const QA_PVC = "qa-storage-claim";
const DEFAULT_STORAGE_CLASS = "standard";

const CLUSTER_SEED = [
  {
    uuid: CLUSTER_ID,
    name: "minikube",
    displayName: "minikube",
    context: "minikube",
    kubeconfigPath: "~/.kube/config",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  },
];

function clusterRoute(workload) {
  return `${BASE_URL}/dashboard/clusters/${CLUSTER_ID}?workload=${workload}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runKubectl(args) {
  try {
    const { stdout, stderr } = await execFileAsync("kubectl", args, {
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      output: stdout,
      errors: stderr,
      code: 0,
    };
  } catch (error) {
    return {
      output: typeof error.stdout === "string" ? error.stdout : "",
      errors:
        typeof error.stderr === "string" && error.stderr.trim()
          ? error.stderr
          : error instanceof Error
            ? error.message
            : String(error),
      code: typeof error.code === "number" ? error.code : 1,
    };
  }
}

async function runNamespacedSnapshot({ resource, selectedNamespace }) {
  if (!resource || typeof resource !== "string") {
    return { items: [], error: "Snapshot resource is required." };
  }

  if (selectedNamespace === "all") {
    const result = await runKubectl(["get", resource, "--all-namespaces", "-o", "json"]);
    if (result.code !== 0) {
      return { items: [], error: result.errors || `Failed to load ${resource}.` };
    }
    const parsed = JSON.parse(result.output);
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  }

  const namespaces = String(selectedNamespace || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (namespaces.length === 0) {
    return { items: [] };
  }

  const items = [];
  for (const namespace of namespaces) {
    const result = await runKubectl(["get", resource, "-n", namespace, "-o", "json"]);
    if (result.code !== 0) {
      return { items: [], error: result.errors || `Failed to load ${resource} in ${namespace}.` };
    }
    const parsed = JSON.parse(result.output);
    if (Array.isArray(parsed.items)) {
      items.push(...parsed.items);
    }
  }
  return { items };
}

async function rozoomInvoke(cmd, payload) {
  if (cmd === "rozoom:kubectl-proxy") {
    return runKubectl(Array.isArray(payload?.args) ? payload.args : []);
  }
  if (cmd === "rozoom:namespaced-snapshot") {
    return runNamespacedSnapshot({
      resource: payload?.resource,
      selectedNamespace: payload?.selectedNamespace,
    });
  }
  if (cmd.startsWith("plugin:cache|")) {
    if (cmd.endsWith("|get")) return null;
    return true;
  }
  if (cmd.startsWith("plugin:log|")) {
    return true;
  }
  throw new Error(`Unsupported invoke command: ${cmd}`);
}

async function seedBrowserState(context) {
  await context.exposeFunction("__rozoomInvoke", rozoomInvoke);
  await context.addInitScript(
    ({ clusterSeed }) => {
      globalThis.localStorage.setItem(
        "tauri-store-fallback:clusters.json",
        JSON.stringify(clusterSeed),
      );
      globalThis.confirm = () => true;
      globalThis.__TAURI_INTERNALS__ = {
        invoke: (cmd, payload) => globalThis.__rozoomInvoke(cmd, payload),
      };
    },
    { clusterSeed: CLUSTER_SEED },
  );
}

async function waitForPageToSettle(page) {
  await page.waitForLoadState("domcontentloaded");
  await sleep(1800);
}

async function clickWhenVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await locator.click();
}

async function ensureStorageFixturesReady() {
  const applyResult = await runKubectl(["apply", "-f", FIXTURE_PATH]);
  if (applyResult.code !== 0) {
    throw new Error(applyResult.errors || "Failed to apply storage fixtures.");
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const pvcResult = await runKubectl(["get", "pvc", QA_PVC, "-n", QA_NAMESPACE, "-o", "json"]);
    if (pvcResult.code === 0) {
      const pvc = JSON.parse(pvcResult.output);
      const phase = pvc?.status?.phase;
      const volumeName =
        typeof pvc?.spec?.volumeName === "string" && pvc.spec.volumeName
          ? pvc.spec.volumeName
          : null;
      if (phase === "Bound" && volumeName) {
        return { volumeName };
      }
    }
    await sleep(2_000);
  }

  throw new Error("Timed out waiting for QA PVC to bind.");
}

async function deletePvcAndWaitGone() {
  const deleteResult = await runKubectl(["delete", "pvc", QA_PVC, "-n", QA_NAMESPACE]);
  if (deleteResult.code !== 0 && !/NotFound/i.test(deleteResult.errors)) {
    throw new Error(deleteResult.errors || "Failed to delete QA PVC.");
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const getResult = await runKubectl(["get", "pvc", QA_PVC, "-n", QA_NAMESPACE]);
    if (getResult.code !== 0) {
      return;
    }
    await sleep(1_500);
  }

  throw new Error("Timed out waiting for QA PVC deletion.");
}

async function runPvcScenario(page) {
  console.log("[persistentvolumeclaims] open page");
  await page.goto(clusterRoute("persistentvolumeclaims"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_PVC);
  await sleep(800);

  await clickWhenVisible(page.getByLabel(`Select storage resource ${QA_PVC}`));
  await page.getByText("1 selected").waitFor({ state: "visible", timeout: 15_000 });

  await clickWhenVisible(page.getByRole("button", { name: "Copy get -o yaml" }));
  await page.getByText(`Copied kubectl get -o yaml for ${QA_PVC}.`).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByRole("button", { name: "Copy describe" }));
  await page.getByText(`Copied kubectl describe for ${QA_PVC}.`).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByText(QA_PVC, { exact: true }).first());
  await page.getByText("Storage resource").waitFor({ state: "visible", timeout: 15_000 });
  const detailsPanel = page.locator("aside").last();
  await detailsPanel.getByText("PersistentVolumeClaim", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await detailsPanel.getByText(DEFAULT_STORAGE_CLASS, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await detailsPanel.getByLabel("Copy kubectl get -o yaml").waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByLabel("Open storage YAML"));
  await page.getByText("Storage YAML").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(`name: ${QA_PVC}`).waitFor({ state: "visible", timeout: 15_000 });
  await clickWhenVisible(page.getByLabel("Close storage YAML"));

  await page.goto(clusterRoute("persistentvolumeclaims"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_PVC);
  await sleep(800);
  await clickWhenVisible(page.getByLabel(`Select storage resource ${QA_PVC}`));

  await clickWhenVisible(page.getByRole("button", { name: "Delete", exact: true }));
  await page.getByText(`Deleted 1 storage resource(s).`).waitFor({
    state: "visible",
    timeout: 20_000,
  });

  await deletePvcAndWaitGone();
  await ensureStorageFixturesReady();

  await page.goto(clusterRoute("persistentvolumeclaims"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_PVC);
  await sleep(800);
  await page.getByText(QA_PVC, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
}

async function runPersistentVolumesScenario(page, volumeName) {
  console.log("[persistentvolumes] open page");
  await page.goto(clusterRoute("persistentvolumes"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill(volumeName);
  await sleep(800);

  await page.getByText(volumeName, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(`${QA_NAMESPACE}/${QA_PVC}`, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText(DEFAULT_STORAGE_CLASS, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runStorageClassesScenario(page) {
  console.log("[storageclasses] open page");
  await page.goto(clusterRoute("storageclasses"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill(DEFAULT_STORAGE_CLASS);
  await sleep(800);

  await page.getByText(DEFAULT_STORAGE_CLASS, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText("StorageClass", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText("Immediate", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function main() {
  await ensureStorageFixturesReady();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1080 },
  });
  context.setDefaultTimeout(20_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: BASE_URL,
  });
  await seedBrowserState(context);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const runtimeErrors = [];

  page.on("pageerror", (error) => {
    if (/Clipboard|writeText/i.test(error.message)) return;
    runtimeErrors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      /favicon|Failed to load resource: the server responded with a status of 404|Clipboard|writeText/i.test(
        text,
      )
    ) {
      return;
    }
    runtimeErrors.push(`console: ${text}`);
  });

  try {
    await runPvcScenario(page);
    const rebound = await ensureStorageFixturesReady();
    await runPersistentVolumesScenario(page, rebound.volumeName);
    await runStorageClassesScenario(page);
    await page.screenshot({
      path: "/tmp/live-qa-storage-smoke.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    await ensureStorageFixturesReady();
  }

  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        clusterId: CLUSTER_ID,
        checkedWorkloads: ["persistentvolumeclaims", "persistentvolumes", "storageclasses"],
        screenshot: "/tmp/live-qa-storage-smoke.png",
      },
      null,
      2,
    ),
  );
}

await main();
