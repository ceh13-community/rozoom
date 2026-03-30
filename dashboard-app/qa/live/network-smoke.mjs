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

async function runServicesScenario(page) {
  console.log("[services] open page");
  await page.goto(clusterRoute("services"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-web");
  await sleep(800);

  await clickWhenVisible(page.getByLabel("Open actions for qa-web"));
  await clickWhenVisible(page.getByRole("menuitem", { name: "Copy kubectl get -o yaml" }));
  await page.getByText("Copied kubectl get -o yaml for qa-web.").waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await clickWhenVisible(page.getByLabel("Open actions for qa-web"));
  await clickWhenVisible(page.getByRole("menuitem", { name: "Open web tool" }));
  await page
    .locator("text=Service web tooling is available only in the desktop runtime.")
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });

  await page.goto(clusterRoute("services"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-web");
  await sleep(800);

  await clickWhenVisible(page.getByText("qa-web", { exact: true }).first());
  await page.getByText("Network resource").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("Open service web tool").waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runEndpointsScenario(page) {
  console.log("[endpoints] open page");
  await page.goto(clusterRoute("endpoints"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-web");
  await sleep(800);
  await page.getByText("qa-web", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await clickWhenVisible(page.getByText("qa-web", { exact: true }).first());
  await page.getByLabel("Copy kubectl get -o yaml").waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runNetworkPoliciesScenario(page) {
  console.log("[networkpolicies] open page");
  await page.goto(clusterRoute("networkpolicies"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill("qa-default-deny");
  await sleep(800);
  await page.getByText("qa-default-deny", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function runIngressScenario(page, workload, resourceName, detailMarker) {
  console.log(`[${workload}] open page`);
  await page.goto(clusterRoute(workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const filterInput = page.getByRole("textbox").first();
  await clickWhenVisible(filterInput);
  await filterInput.fill(resourceName);
  await sleep(800);
  await page
    .getByText(resourceName, { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByText(detailMarker, { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
}

const GATEWAY_API_KIND_MARKERS = {
  gatewayclasses: "GatewayClass",
  gateways: "Gateway",
  httproutes: "HTTPRoute",
  referencegrants: "ReferenceGrant",
};

async function runGatewayApiEmptyScenario(page, workload) {
  console.log(`[${workload}] open page`);
  await page.goto(clusterRoute(workload), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const bodyText = await page.locator("body").innerText();
  if (new RegExp(`No ${workload} found in the selected namespace\\.`, "i").test(bodyText)) {
    return;
  }

  await page.getByPlaceholder("Filter by gateway resource, scope, kind, signal, or ports").waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const expectedKind = GATEWAY_API_KIND_MARKERS[workload];
  assert.match(
    bodyText,
    new RegExp(`No results for the current filter\\.|\\b${expectedKind}\\b`, "i"),
    `Gateway API page ${workload} did not render a valid live-state variant.`,
  );
}

async function runPortForwardingScenario(page) {
  console.log("[portforwarding] open page");
  await page.goto(clusterRoute("portforwarding"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page);

  const resourceInput = page.getByPlaceholder("svc/my-service");
  const localPortInput = page.getByRole("textbox", { name: "Local port" });
  const remotePortInput = page.getByRole("textbox", { name: "Remote port" });

  await clickWhenVisible(resourceInput);
  await resourceInput.fill("svc/qa-web");
  await localPortInput.fill("32456");
  await remotePortInput.fill("80");
  await clickWhenVisible(page.getByRole("button", { name: "Start" }));
  await page.getByText("Port-forwarding is available only in the desktop runtime.").waitFor({
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
    await runServicesScenario(page);
    await runEndpointsScenario(page);
    await runNetworkPoliciesScenario(page);
    await runIngressScenario(page, "ingresses", "qa-web", "qa-nginx");
    await runIngressScenario(page, "ingressclasses", "qa-nginx", "k8s.io/ingress-nginx");
    await runGatewayApiEmptyScenario(page, "gatewayclasses");
    await runGatewayApiEmptyScenario(page, "gateways");
    await runGatewayApiEmptyScenario(page, "httproutes");
    await runGatewayApiEmptyScenario(page, "referencegrants");
    await runPortForwardingScenario(page);
    await page.screenshot({
      path: "/tmp/live-qa-network-smoke.png",
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
          "services",
          "endpoints",
          "networkpolicies",
          "ingresses",
          "ingressclasses",
          "gatewayclasses",
          "gateways",
          "httproutes",
          "referencegrants",
          "portforwarding",
        ],
        screenshot: "/tmp/live-qa-network-smoke.png",
      },
      null,
      2,
    ),
  );
}

await main();
