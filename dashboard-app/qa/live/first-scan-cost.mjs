/* global console, process, setTimeout */
/**
 * Measures the cost of the FIRST diagnostic scan (linter on by default):
 * time from opening /dashboard to the cluster card rendering a real,
 * error-free health check (the same condition that fires
 * rozoom_first_diagnostic_rendered). Runs against a live cluster through
 * the same browser bridge as workbench-parity.mjs. Cache plugin returns
 * null, so every run is a cold first scan.
 *
 * Usage: node ./qa/live/first-scan-cost.mjs [runs]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.LIVE_QA_BASE_URL ?? "http://127.0.0.1:1420";
const CLUSTER_ID = "c595d4b2-20a4-4fe9-b254-5300130893ae";
const RUNS = Number(process.argv[2] ?? 3);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let kubectlCalls = 0;
async function runKubectl(args) {
  kubectlCalls += 1;
  if (process.env.LOG_KUBECTL) console.log("  kubectl", args.slice(0, 6).join(" "));
  try {
    const { stdout, stderr } = await execFileAsync("kubectl", args, {
      maxBuffer: 50 * 1024 * 1024,
    });
    return { output: stdout, errors: stderr, code: 0 };
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
  const items = [];
  for (const namespace of namespaces) {
    const result = await runKubectl(["get", resource, "-n", namespace, "-o", "json"]);
    if (result.code !== 0) {
      return { items: [], error: result.errors || `Failed to load ${resource} in ${namespace}.` };
    }
    const parsed = JSON.parse(result.output);
    if (Array.isArray(parsed.items)) items.push(...parsed.items);
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
  if (cmd === "plugin:path|resolve_directory") return "/tmp";
  if (cmd.startsWith("plugin:log|")) return true;
  throw new Error(`Unsupported invoke command: ${cmd}`);
}

async function measureOnce(browser, runIndex) {
  kubectlCalls = 0;
  const context = await browser.newContext();
  await context.exposeFunction("__rozoomInvoke", rozoomInvoke);
  await context.addInitScript(
    ({ clusterSeed }) => {
      globalThis.localStorage.setItem(
        "tauri-store-fallback:clusters.json",
        JSON.stringify({ clusters: clusterSeed }),
      );
      globalThis.confirm = () => true;
      globalThis.__TAURI_INTERNALS__ = {
        invoke: (cmd, payload) => globalThis.__rozoomInvoke(cmd, payload),
      };
    },
    { clusterSeed: CLUSTER_SEED },
  );
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const tDom = Date.now();

  const card = page.locator('[data-testid="cluster-card"]').first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  const tCard = Date.now();

  // Rendered first diagnostic = card shows an error-free health check:
  // pre-scan states are Pending/Paused/Checking; a real check renders the
  // namespaces/score summary. Detect by text transition away from the
  // waiting states while cluster stats text appears.
  let tDone = null;
  const deadline = Date.now() + 180_000;
  let lastText = "";
  while (Date.now() < deadline) {
    lastText = await card.innerText().catch(() => "");
    const waiting = /Pending|Paused|Checking/i.test(lastText);
    const hasData = /\d+\s*ns\b/.test(lastText) && /\d+\s*pods\b/.test(lastText);
    if (!waiting && hasData) {
      tDone = Date.now();
      break;
    }
    await sleep(100);
  }
  if (!tDone) {
    console.error(`run ${runIndex}: TIMEOUT. Last card text:\n${lastText.slice(0, 600)}`);
  } else {
    console.log(
      `run ${runIndex}: dom=${tDom - t0}ms card=${tCard - t0}ms firstDiagnostic=${tDone - t0}ms kubectlCalls=${kubectlCalls}`,
    );
  }
  await context.close();
  return tDone ? tDone - t0 : null;
}

const browser = await chromium.launch();
const results = [];
for (let i = 1; i <= RUNS; i += 1) {
  const value = await measureOnce(browser, i);
  if (value !== null) results.push(value);
}
await browser.close();
if (results.length > 0) {
  const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
  console.log(
    `runs=${results.length} min=${Math.min(...results)}ms max=${Math.max(...results)}ms avg=${avg}ms`,
  );
}
process.exit(results.length === RUNS ? 0 : 1);
