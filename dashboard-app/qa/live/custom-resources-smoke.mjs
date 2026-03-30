/* global console, process, setTimeout */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.LIVE_QA_BASE_URL ?? "http://127.0.0.1:1420";
const CLUSTER_ID = process.env.LIVE_QA_CLUSTER_ID ?? "c595d4b2-20a4-4fe9-b254-5300130893ae";
const FIXTURE_PATH = "./qa/fixtures/live-workloads.yaml";
const QA_CRD = "qaexamples.qa.rozoom.dev";
const QA_GROUP = "qa.rozoom.dev";
const QA_RESOURCE = "qaexamples";
const QA_VERSION = "v1alpha1";

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

async function ensureCustomResourceFixtureReady() {
  const applyResult = await runKubectl(["apply", "-f", FIXTURE_PATH]);
  if (applyResult.code !== 0) {
    throw new Error(applyResult.errors || "Failed to apply custom resource fixtures.");
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await runKubectl(["get", "crd", QA_CRD, "-o", "json"]);
    if (result.code === 0) {
      const parsed = JSON.parse(result.output);
      const conditions = Array.isArray(parsed?.status?.conditions) ? parsed.status.conditions : [];
      const established = conditions.some(
        (entry) => entry?.type === "Established" && entry?.status === "True",
      );
      if (established) return;
    }
    await sleep(2_000);
  }

  throw new Error("Timed out waiting for QA CRD to become established.");
}

async function waitForCustomResourceDeletion() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await runKubectl(["get", "crd", QA_CRD]);
    if (result.code !== 0) return;
    await sleep(1_500);
  }
  throw new Error("Timed out waiting for QA CRD deletion.");
}

async function runCustomResourcesScenario(page) {
  console.log("[customresourcedefinitions] open page");
  await page.goto(clusterRoute("customresourcedefinitions"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder(
    "Filter by name, group, version, scope, resource, or summary",
  );
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_CRD);
  await sleep(800);

  await page.getByText(QA_CRD, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(QA_GROUP, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(QA_VERSION, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(QA_RESOURCE, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  await clickWhenVisible(page.getByLabel(`Select custom resource definition ${QA_CRD}`));
  await page.getByText("1 selected").waitFor({ state: "visible", timeout: 15_000 });

  await clickWhenVisible(page.getByRole("button", { name: "Copy get -o yaml" }));
  await page.getByText(`Copied kubectl get -o yaml for ${QA_CRD}.`).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByRole("button", { name: "Copy describe" }));
  await page.getByText(`Copied kubectl describe for ${QA_CRD}.`).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByRole("button", { name: "Open YAML" }));
  await page.getByText("Custom Resource Definition YAML").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText(`name: ${QA_CRD}`).waitFor({ state: "visible", timeout: 15_000 });
  await clickWhenVisible(page.getByLabel("Close custom resource definition YAML"));

  await page.goto(clusterRoute("customresourcedefinitions"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_CRD);
  await sleep(800);

  await clickWhenVisible(page.getByText(QA_CRD, { exact: true }).first());
  const detailsPanel = page.locator("aside").last();
  await detailsPanel.getByText("Custom Resource Definition", { exact: false }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await detailsPanel.getByText(QA_GROUP, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await detailsPanel.getByText(QA_RESOURCE, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await page.goto(clusterRoute("customresourcedefinitions"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_CRD);
  await sleep(800);
  await clickWhenVisible(page.getByLabel(`Select custom resource definition ${QA_CRD}`));
  await clickWhenVisible(page.getByRole("button", { name: "Delete", exact: true }));
  await page.getByText("Deleted 1 custom resource definition(s).").waitFor({
    state: "visible",
    timeout: 20_000,
  });

  await waitForCustomResourceDeletion();
  await ensureCustomResourceFixtureReady();

  await page.goto(clusterRoute("customresourcedefinitions"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await clickWhenVisible(filterInput);
  await filterInput.fill(QA_CRD);
  await sleep(800);
  await page.getByText(QA_CRD, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
}

async function main() {
  await ensureCustomResourceFixtureReady();

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
    await runCustomResourcesScenario(page);
    await page.screenshot({
      path: "/tmp/live-qa-custom-resources-smoke.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
    await ensureCustomResourceFixtureReady();
  }

  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        clusterId: CLUSTER_ID,
        checkedWorkloads: ["customresourcedefinitions"],
        screenshot: "/tmp/live-qa-custom-resources-smoke.png",
      },
      null,
      2,
    ),
  );
}

await main();
