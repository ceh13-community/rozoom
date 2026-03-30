/* global console, process, setTimeout */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.LIVE_QA_BASE_URL ?? "http://127.0.0.1:1420";
const CLUSTER_ID = process.env.LIVE_QA_CLUSTER_ID ?? "c595d4b2-20a4-4fe9-b254-5300130893ae";
const QA_NAMESPACE = "qa-workloads";

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

const SCENARIOS = [
  { workload: "pods", resourceKind: "pod", resourcePrefix: "qa-api-" },
  { workload: "deployments", resourceKind: "deployment", resourceName: "qa-api" },
  { workload: "daemonsets", resourceKind: "daemonset", resourceName: "qa-daemon" },
  { workload: "statefulsets", resourceKind: "statefulset", resourceName: "qa-stateful" },
  { workload: "replicasets", resourceKind: "replicaset", resourcePrefix: "qa-api-" },
  { workload: "jobs", resourceKind: "job", resourceName: "qa-job" },
  { workload: "cronjobs", resourceKind: "cronjob", resourceName: "qa-cron" },
  { workload: "nodesstatus", resourceKind: "node", scenarioType: "nodes" },
  { workload: "replicationcontrollers", scenarioType: "route-shell" },
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

async function resolveScenarioName(scenario) {
  if (scenario.resourceKind === "node") {
    const result = await runKubectl(["get", "nodes", "-o", "json"]);
    if (result.code !== 0) {
      throw new Error(result.errors || "Failed to resolve node.");
    }
    const parsed = JSON.parse(result.output);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const found = items.find((item) => typeof item?.metadata?.name === "string");
    if (!found?.metadata?.name) {
      throw new Error("Expected at least one node in the cluster.");
    }
    return found.metadata.name;
  }

  if (scenario.resourceName) return scenario.resourceName;
  const result = await runKubectl(["get", scenario.resourceKind, "-n", QA_NAMESPACE, "-o", "json"]);
  if (result.code !== 0) {
    throw new Error(result.errors || `Failed to resolve ${scenario.resourceKind}.`);
  }
  const parsed = JSON.parse(result.output);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const found = items.find((item) =>
    String(item?.metadata?.name || "").startsWith(scenario.resourcePrefix),
  );
  if (!found?.metadata?.name) {
    throw new Error(
      `Failed to resolve ${scenario.resourceKind} with prefix ${scenario.resourcePrefix}.`,
    );
  }
  return found.metadata.name;
}

async function openMenuAction(page, name, actionLabel) {
  await clickWhenVisible(page.getByLabel(`Open actions for ${name}`).last());
  await clickWhenVisible(page.getByRole("menuitem", { name: actionLabel, exact: true }));
}

async function runScenario(page, scenario, failures) {
  console.log(`[${scenario.workload}] open page`);
  await page.goto(clusterRoute(scenario.workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const bodyText = await page.locator("body").innerText();
  if (/Application Error|Unexpected Application Error|Error 404/i.test(bodyText)) {
    failures.push(`${scenario.workload}: routed into an error screen`);
    return;
  }

  if (scenario.scenarioType === "route-shell") {
    const bodyText = await page.locator("body").innerText();
    const hasEmptyState = /No replicationcontrollers found in the selected namespace\./i.test(
      bodyText,
    );
    if (!hasEmptyState) {
      await page.getByText("Replication Controllers Runtime Status").waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.getByText("Route scoped", { exact: true }).waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.getByText("A list of replication controllers.").waitFor({
        state: "visible",
        timeout: 20_000,
      });
    }
    await page.screenshot({
      path: `/tmp/workbench-parity-${scenario.workload}.png`,
      fullPage: true,
    });
    return;
  }

  const resolvedName = await resolveScenarioName(scenario);

  if (scenario.scenarioType === "nodes") {
    console.log(`[${scenario.workload}] edit yaml`);
    await openMenuAction(page, resolvedName, "Edit");
    await page.getByRole("button", { name: "Reopen" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Fullscreen" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Apply" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.getByText(`Resource YAML: ${resolvedName}`).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.screenshot({
      path: `/tmp/workbench-parity-${scenario.workload}.png`,
      fullPage: true,
    });
    return;
  }

  console.log(`[${scenario.workload}] logs`);
  await openMenuAction(page, resolvedName, "Logs");
  await page.getByRole("button", { name: "Reopen" }).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Fullscreen" }).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByText(new RegExp(`Pod logs: ${QA_NAMESPACE}/${resolvedName}`)).waitFor({
    state: "visible",
    timeout: 20_000,
  });

  console.log(`[${scenario.workload}] investigate`);
  await openMenuAction(page, resolvedName, "Investigate");
  await page.getByText(new RegExp(`Pod logs: ${QA_NAMESPACE}/${resolvedName}`)).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByText(new RegExp(`Resource YAML: ${QA_NAMESPACE}/${resolvedName}`)).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByText("Pane 1").waitFor({
    state: "visible",
    timeout: 20_000,
  });

  console.log(`[${scenario.workload}] edit yaml`);
  await openMenuAction(page, resolvedName, "Edit YAML");
  await page.getByRole("button", { name: "Apply" }).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Reopen" }).waitFor({
    state: "visible",
    timeout: 20_000,
  });

  await page.screenshot({
    path: `/tmp/workbench-parity-${scenario.workload}.png`,
    fullPage: true,
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

  const failures = [];
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
    for (const scenario of SCENARIOS) {
      await runScenario(page, scenario, failures);
    }
  } finally {
    await browser.close();
  }

  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        clusterId: CLUSTER_ID,
        checkedWorkloads: SCENARIOS.map((scenario) => scenario.workload),
      },
      null,
      2,
    ),
  );
}

await main();
