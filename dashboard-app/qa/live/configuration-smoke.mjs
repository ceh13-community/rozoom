/* global console, process, setTimeout */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.LIVE_QA_BASE_URL ?? "http://127.0.0.1:1420";
const CLUSTER_ID = process.env.LIVE_QA_CLUSTER_ID ?? "c595d4b2-20a4-4fe9-b254-5300130893ae";

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
  if (cmd === "plugin:path|resolve_directory") {
    return "/tmp";
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

async function clickWhenVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await locator.click();
}

async function waitForPageToSettle(page) {
  await page.waitForLoadState("domcontentloaded");
  await sleep(1800);
}

async function runNamespacesScenario(page) {
  console.log("[namespaces] open page");
  await page.goto(clusterRoute("namespaces"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder("Filter by namespace, phase, labels, or annotations");
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-workloads");
  await sleep(800);
  await page.getByText("qa-workloads").waitFor({ state: "visible", timeout: 15_000 });
}

async function runSecretsScenario(page) {
  console.log("[secrets] open page");
  await page.goto(clusterRoute("secrets"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  await page
    .getByText("Secret values are intentionally hidden here. This section shows metadata only.")
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });

  const filterInput = page.getByPlaceholder("Filter by secret, namespace, type, labels, or signal");
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-secret");
  await sleep(800);
  await page.getByText("qa-secret").waitFor({ state: "visible", timeout: 15_000 });
}

async function runConfigMapsScenario(page) {
  console.log("[configmaps] open page");
  await page.goto(clusterRoute("configmaps"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder("Filter by name, namespace, kind, or summary");
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-config");
  await sleep(800);

  await page.getByText("qa-config").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("ConfigMap", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runConfigurationCoreScenario(page, workload, resourceName, kindText) {
  console.log(`[${workload}] open page`);
  await page.goto(clusterRoute(workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder("Filter by name, namespace, kind, or summary");
  await clickWhenVisible(filterInput);
  await filterInput.fill(resourceName);
  await sleep(800);
  await page.getByText(resourceName, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText(kindText, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runPolicyControlScenario(page, workload, resourceName, kindText) {
  console.log(`[${workload}] open page`);
  await page.goto(clusterRoute(workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder("Filter by resource, scope, kind, signal, or risk");
  await clickWhenVisible(filterInput);
  await filterInput.fill(resourceName);
  await sleep(800);
  await page.getByText(resourceName, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText(kindText, { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runAccessControlScenario(
  page,
  workload,
  resourceName,
  detailsTitle = "Access-control resource",
) {
  console.log(`[${workload}] open page`);
  await page.goto(clusterRoute(workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder(
    "Filter by name, namespace, kind, subjects, rules, or summary",
  );
  await clickWhenVisible(filterInput);
  await filterInput.fill(resourceName);
  await sleep(800);

  await clickWhenVisible(page.getByLabel(`Open actions for ${resourceName}`));
  await clickWhenVisible(page.getByRole("menuitem", { name: "Copy kubectl get -o yaml" }));
  await page.getByText(`Copied kubectl get -o yaml for ${resourceName}.`).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByLabel(`Open actions for ${resourceName}`));
  await clickWhenVisible(page.getByRole("menuitem", { name: "Open YAML" }));
  await page.getByText(`Loaded YAML for ${resourceName}.`).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByText("Access-control YAML").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Copy YAML" }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await page.goto(clusterRoute(workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await page
    .getByPlaceholder("Filter by name, namespace, kind, subjects, rules, or summary")
    .fill(resourceName);
  await sleep(800);
  await clickWhenVisible(page.getByText(resourceName).first());
  await page.getByText(detailsTitle).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByLabel("Copy kubectl get -o yaml").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByLabel("Open access-control YAML").waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function main() {
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
    await runNamespacesScenario(page);
    await runSecretsScenario(page);
    await runConfigMapsScenario(page);
    await runConfigurationCoreScenario(page, "resourcequotas", "qa-quota", "ResourceQuota");
    await runConfigurationCoreScenario(page, "limitranges", "qa-limits", "LimitRange");
    await runConfigurationCoreScenario(page, "leases", "qa-lease", "Lease");
    await runPolicyControlScenario(page, "priorityclasses", "qa-priority", "PriorityClass");
    await runPolicyControlScenario(
      page,
      "horizontalpodautoscalers",
      "qa-web",
      "HorizontalPodAutoscaler",
    );
    await runPolicyControlScenario(
      page,
      "poddisruptionbudgets",
      "qa-web-pdb",
      "PodDisruptionBudget",
    );
    await runPolicyControlScenario(page, "runtimeclasses", "qa-runtime", "RuntimeClass");
    await runPolicyControlScenario(
      page,
      "mutatingwebhookconfigurations",
      "qa-mutating",
      "MutatingWebhookConfiguration",
    );
    await runPolicyControlScenario(
      page,
      "validatingwebhookconfigurations",
      "qa-validating",
      "ValidatingWebhookConfiguration",
    );
    await runAccessControlScenario(page, "serviceaccounts", "qa-serviceaccount");
    await runAccessControlScenario(page, "roles", "qa-reader");
    await runAccessControlScenario(page, "rolebindings", "qa-reader");
    await runAccessControlScenario(page, "clusterroles", "qa-cluster-reader");
    await runAccessControlScenario(page, "clusterrolebindings", "qa-cluster-reader");
    await page.screenshot({
      path: "/tmp/live-qa-configuration-smoke.png",
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        clusterId: CLUSTER_ID,
        checkedWorkloads: [
          "namespaces",
          "secrets",
          "configmaps",
          "resourcequotas",
          "limitranges",
          "leases",
          "priorityclasses",
          "horizontalpodautoscalers",
          "poddisruptionbudgets",
          "runtimeclasses",
          "mutatingwebhookconfigurations",
          "validatingwebhookconfigurations",
          "serviceaccounts",
          "roles",
          "rolebindings",
          "clusterroles",
          "clusterrolebindings",
        ],
        screenshot: "/tmp/live-qa-configuration-smoke.png",
      },
      null,
      2,
    ),
  );
}

await main();
