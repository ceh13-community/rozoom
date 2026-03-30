/* global console, process, setTimeout */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.LIVE_QA_BASE_URL ?? "http://127.0.0.1:1420";
const CLUSTER_ID = process.env.LIVE_QA_CLUSTER_ID ?? "c595d4b2-20a4-4fe9-b254-5300130893ae";
const PODS_ONLY = process.argv.includes("--pods-only");

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

const ALL_WORKLOADS = [
  "overview",
  "globaltriage",
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "replicationcontrollers",
  "jobs",
  "cronjobs",
  "cronjobshealth",
  "deprecationscan",
  "versionaudit",
  "backupaudit",
  "helm",
  "alertshub",
  "armorhub",
  "metricssources",
  "compliancehub",
  "trivyhub",
  "nodesstatus",
  "nodespressures",
  "namespaces",
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "priorityclasses",
  "runtimeclasses",
  "leases",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "accessreviews",
  "customresourcedefinitions",
  "services",
  "endpoints",
  "ingresses",
  "ingressclasses",
  "gatewayclasses",
  "gateways",
  "httproutes",
  "referencegrants",
  "portforwarding",
  "networkpolicies",
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
];

const WORKLOAD_EXPECTATIONS = new Map([
  ["overview", /Overview Runtime Status/i],
  ["globaltriage", /Global Triage|Triage/i],
  ["pods", /Pods Runtime Status|Filter by pod/i],
  ["deployments", /qa-web|qa-api/],
  ["daemonsets", /qa-daemon/],
  ["statefulsets", /qa-stateful/],
  ["jobs", /qa-job/],
  ["cronjobs", /qa-cron/],
  ["namespaces", /qa-workloads/],
  ["configmaps", /qa-config/],
  ["secrets", /qa-secret/],
  ["resourcequotas", /qa-quota/],
  ["limitranges", /qa-limits/],
  ["horizontalpodautoscalers", /qa-web/],
  ["poddisruptionbudgets", /qa-web-pdb/],
  ["priorityclasses", /qa-priority/],
  ["serviceaccounts", /qa-serviceaccount/],
  ["roles", /qa-reader/],
  ["rolebindings", /qa-reader/],
  ["services", /qa-web|qa-stateful/],
  ["networkpolicies", /qa-default-deny/],
]);

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

async function runWorkloadSmoke(page, failures) {
  for (const workload of ALL_WORKLOADS) {
    console.log(`[workload] ${workload}`);
    try {
      await page.goto(clusterRoute(workload), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await waitForPageToSettle(page);

      const bodyText = await page.locator("body").innerText();
      if (/Application Error|Unexpected Application Error|Error 404/i.test(bodyText)) {
        failures.push(`workload=${workload}: routed into an error screen`);
        continue;
      }

      const expected = WORKLOAD_EXPECTATIONS.get(workload);
      if (expected && !expected.test(bodyText)) {
        failures.push(`workload=${workload}: expected ${expected} but body did not contain it`);
      }
    } catch (error) {
      failures.push(
        `workload=${workload}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function runPodsFlow(page, failures) {
  console.log("[pods] open page");
  await page.goto(clusterRoute("pods"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByPlaceholder("Filter by pod, namespace, node, or status");
  console.log("[pods] filter qa-*");
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-");
  await sleep(1200);

  const qaApiCheckbox = page.getByLabel(/^Select pod qa-api-/).first();
  console.log("[pods] select qa-api");
  await clickWhenVisible(qaApiCheckbox);
  await page.getByText("1 selected").waitFor({ state: "visible", timeout: 15_000 });

  console.log("[pods] copy describe");
  await clickWhenVisible(page.getByRole("button", { name: "Copy kubectl describe" }));
  await sleep(500);

  console.log("[pods] open logs");
  await clickWhenVisible(page.getByRole("button", { name: "Logs", exact: true }));
  await page.getByText(/Pod logs: qa-workloads\/qa-api-/).waitFor({
    state: "visible",
    timeout: 20_000,
  });

  console.log("[pods] investigate");
  await clickWhenVisible(page.getByRole("button", { name: "Investigate", exact: true }));
  await page.getByText(/Opened workbench for qa-workloads\/qa-api-/).waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByText(/Pod events: qa-workloads\/qa-api-/).waitFor({
    state: "visible",
    timeout: 20_000,
  });

  console.log("[pods] open yaml");
  await clickWhenVisible(page.getByRole("button", { name: "Edit YAML", exact: true }));
  await page.getByRole("button", { name: "Apply" }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  console.log("[pods] delete qa-api pod");
  await clickWhenVisible(page.getByRole("button", { name: /^Open actions for qa-api-/ }).first());
  await clickWhenVisible(page.getByRole("menuitem", { name: "Delete" }));
  await filterInput.fill("qa-api-");
  await sleep(5000);
  const apiPodCount = await page.locator("text=/qa-api-/").count();
  if (apiPodCount === 0) {
    failures.push("pods: qa-api replacement pod did not appear after delete");
  }

  console.log("[pods] evict qa-web pod");
  await filterInput.fill("qa-web-");
  await sleep(1200);
  const qaWebAction = page.getByRole("button", { name: /^Open actions for qa-web-/ }).first();
  await clickWhenVisible(qaWebAction);
  await clickWhenVisible(page.getByRole("menuitem", { name: /Evict \(one-way\)/ }));
  await sleep(5000);
  const webPodCount = await page.locator("text=/qa-web-/").count();
  if (webPodCount === 0) {
    failures.push("pods: qa-web replacement pod did not appear after evict");
  }

  console.log("[pods] open details");
  await filterInput.fill("qa-stateful-0");
  await sleep(1200);
  await clickWhenVisible(page.getByText("qa-stateful-0").first());
  await page.getByText(/Properties|Pod Details/i).waitFor({
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

  const failures = [];
  const runtimeErrors = [];
  let mainError = null;

  page.on("pageerror", (error) => {
    if (/Clipboard|writeText/i.test(error.message)) {
      return;
    }
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
    if (!PODS_ONLY) {
      await runWorkloadSmoke(page, failures);
    }
    await runPodsFlow(page, failures);
  } catch (error) {
    mainError = error;
  } finally {
    try {
      await page.screenshot({
        path: "/tmp/live-qa-workloads-smoke.png",
        fullPage: true,
        timeout: 5_000,
      });
    } catch (error) {
      console.warn(
        `[warn] screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await browser.close();
  }

  if (mainError) {
    throw mainError;
  }
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        clusterId: CLUSTER_ID,
        checkedWorkloads: PODS_ONLY ? 1 : ALL_WORKLOADS.length,
        screenshot: "/tmp/live-qa-workloads-smoke.png",
      },
      null,
      2,
    ),
  );
}

await main();
