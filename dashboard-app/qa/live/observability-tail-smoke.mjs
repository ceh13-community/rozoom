/* global console, process, setTimeout */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
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

function normalizeProgram(program) {
  if (typeof program !== "string" || program.length === 0) {
    throw new Error("Shell program is required.");
  }
  if (program.startsWith("binaries/")) {
    return path.posix.basename(program);
  }
  return path.basename(program);
}

async function runCommand(program, args = []) {
  const normalizedProgram = normalizeProgram(program);
  try {
    const { stdout, stderr } = await execFileAsync(normalizedProgram, args, {
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      code: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr:
        typeof error.stderr === "string" && error.stderr.trim()
          ? error.stderr
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

async function runKubectl(args) {
  const result = await runCommand("kubectl", args);
  return {
    output: result.stdout,
    errors: result.stderr,
    code: result.code,
  };
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

async function rozoomShellExecute(program, args) {
  return runCommand(program, Array.isArray(args) ? args : []);
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
  if (cmd === "plugin:path|resolve_directory") {
    return "/tmp";
  }
  if (cmd === "plugin:path|join" || cmd === "plugin:path|resolve") {
    return path.join(...(Array.isArray(payload?.paths) ? payload.paths : []));
  }
  if (cmd === "plugin:path|dirname") {
    return path.dirname(String(payload?.path ?? ""));
  }
  if (cmd === "plugin:path|basename") {
    const target = String(payload?.path ?? "");
    const ext = typeof payload?.ext === "string" ? payload.ext : undefined;
    return path.basename(target, ext);
  }
  if (cmd === "plugin:path|extname") {
    return path.extname(String(payload?.path ?? ""));
  }
  if (cmd === "plugin:path|is_absolute") {
    return path.isAbsolute(String(payload?.path ?? ""));
  }
  if (cmd.startsWith("plugin:cache|")) {
    if (cmd.endsWith("|get")) return null;
    return true;
  }
  if (cmd.startsWith("plugin:log|")) {
    return true;
  }
  if (cmd === "plugin:fs|exists") {
    try {
      await access(String(payload?.path ?? ""));
      return true;
    } catch {
      return false;
    }
  }
  if (cmd === "plugin:os|locale") {
    return "en-US";
  }
  if (cmd === "plugin:os|hostname") {
    return "rozoom";
  }
  if (cmd === "plugin:shell|execute") {
    return rozoomShellExecute(payload?.program, payload?.args);
  }
  throw new Error(`Unsupported invoke command: ${cmd}`);
}

async function seedBrowserState(context) {
  await context.exposeFunction("__rozoomInvoke", rozoomInvoke);
  await context.exposeFunction("__rozoomShellExecute", rozoomShellExecute);
  await context.addInitScript(
    ({ clusterSeed }) => {
      const callbacks = new Map();
      let callbackId = 1;
      let pid = 1;

      function transformCallback(callback, once = false) {
        const id = callbackId++;
        callbacks.set(id, { callback, once });
        return id;
      }

      function unregisterCallback(id) {
        callbacks.delete(id);
      }

      function dispatchCallback(id, rawMessage) {
        const entry = callbacks.get(id);
        if (!entry) return;
        entry.callback(rawMessage);
        if (entry.once) {
          callbacks.delete(id);
        }
      }

      function parseChannelId(value) {
        if (typeof value === "object" && value !== null && typeof value.id === "number") {
          return value.id;
        }
        if (typeof value !== "string") return null;
        const match = value.match(/^__CHANNEL__:(\d+)$/);
        return match ? Number(match[1]) : null;
      }

      globalThis.localStorage.setItem(
        "tauri-store-fallback:clusters.json",
        JSON.stringify(clusterSeed),
      );
      globalThis.confirm = () => true;
      globalThis.__TAURI_OS_PLUGIN_INTERNALS__ = {
        platform: "linux",
        version: "6.8.0",
        family: "unix",
        os_type: "linux",
        arch: "x86_64",
        exe_extension: "",
        eol: "\n",
      };
      globalThis.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: {},
        },
        transformCallback,
        unregisterCallback,
        invoke: async (cmd, payload) => {
          if (cmd === "plugin:shell|spawn") {
            const currentPid = pid++;
            const channelId = parseChannelId(payload?.onEvent);
            void Promise.resolve().then(async () => {
              const result = await globalThis.__rozoomShellExecute(payload?.program, payload?.args);
              if (channelId == null) return;
              let index = 0;
              if (result.stdout) {
                dispatchCallback(channelId, {
                  index,
                  message: { event: "Stdout", payload: result.stdout },
                });
                index += 1;
              }
              if (result.stderr) {
                dispatchCallback(channelId, {
                  index,
                  message: { event: "Stderr", payload: result.stderr },
                });
                index += 1;
              }
              dispatchCallback(channelId, {
                index,
                message: { event: "Terminated", payload: { code: result.code } },
              });
              dispatchCallback(channelId, { index: index + 1, end: true });
            });
            return currentPid;
          }
          if (cmd === "plugin:shell|stdin_write" || cmd === "plugin:shell|kill") {
            return true;
          }
          return globalThis.__rozoomInvoke(cmd, payload);
        },
      };
    },
    { clusterSeed: CLUSTER_SEED },
  );
}

async function waitForPageToSettle(page, extraMs = 2500) {
  await page.waitForLoadState("domcontentloaded");
  await sleep(extraMs);
}

async function runPodRestartsScenario(page) {
  console.log("[podsrestarts] open page");
  await page.goto(clusterRoute("podsrestarts"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page, 4500);

  await page
    .getByRole("heading", { name: /Pod Restarts|Podsrestarts - Cluster:/ })
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });
  await page
    .getByText(/No results for the current filter\.|Pod|Container|Restarts/i)
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });
}

async function runCronJobsHealthScenario(page) {
  console.log("[cronjobshealth] open page");
  await page.goto(clusterRoute("cronjobshealth"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page, 5000);

  await page.getByText("Only problematic").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.getByText("Scheduled CronJobs with health indicators.").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page
    .getByText(/No results for the current filter\.|Namespace|CronJob|Status|qa-cron/i)
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });
}

async function runNodesPressuresScenario(page) {
  console.log("[nodespressures] open page");
  await page.goto(clusterRoute("nodespressures"), {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForPageToSettle(page, 4500);

  await page.getByRole("button", { name: "Refresh" }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page
    .getByText(/No results for the current filter\.|Disk Pressure|Memory Pressure|Ready/i)
    .first()
    .waitFor({
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
    await runPodRestartsScenario(page);
    await runCronJobsHealthScenario(page);
    await runNodesPressuresScenario(page);
    await page.screenshot({
      path: "/tmp/live-qa-observability-tail-smoke.png",
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
        checkedWorkloads: ["podsrestarts", "cronjobshealth", "nodespressures"],
        screenshot: "/tmp/live-qa-observability-tail-smoke.png",
      },
      null,
      2,
    ),
  );
}

await main();
