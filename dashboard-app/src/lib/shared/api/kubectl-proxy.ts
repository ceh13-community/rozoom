import { Command, type Child } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";
import { error as logError } from "@tauri-apps/plugin-log";
import type { KubectlOptions } from "../model/kubectl";
import { CONFIG_DIR } from "$entities/config/model/appConfig";
import { clusterKey } from "$shared/lib/cluster-key";
import {
  isCommandUnavailableProbeError,
  isExpectedClusterProbeError,
} from "$shared/lib/runtime-probe-errors";
import { getBrowserInvokeFallback, isTauriAvailable } from "$shared/lib/tauri-runtime";
import { isRuntimeDebugEnabled, writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
import { emitCliNotification, isUserFacingCommand } from "$shared/lib/cli-notification";

type KubectlExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type KubectlExecutionBudget = {
  maxConcurrentExecs: number;
  maxConcurrentWatches: number;
};

const kubectlReadInFlight = new Map<
  string,
  Promise<{ output: string; errors: string; code?: number }>
>();
const DEFAULT_READ_REQUEST_TIMEOUT = "--request-timeout=10s";
const KUBECTL_ERROR_LOG_WINDOW_MS = 15_000;
const DEFAULT_KUBECTL_EXECUTION_BUDGET: KubectlExecutionBudget = {
  maxConcurrentExecs: 6,
  maxConcurrentWatches: 2,
};
const recentKubectlErrorLogs = new Map<string, number>();
let kubectlExecutionBudget: KubectlExecutionBudget = { ...DEFAULT_KUBECTL_EXECUTION_BUDGET };
let activeKubectlExecs = 0;
let activeKubectlWatches = 0;
const kubectlExecQueue: Array<() => void> = [];
const kubectlWatchQueue: Array<() => void> = [];

type BrowserInvokeResult =
  | string
  | {
      output?: string;
      errors?: string;
      code?: number;
    };

function getBrowserInvoke() {
  const invoke = getBrowserInvokeFallback() as
    | ((cmd: string, payload?: unknown) => Promise<BrowserInvokeResult>)
    | null;
  return typeof invoke === "function" ? invoke : null;
}

function canUseDesktopKubectlRuntime() {
  if (typeof window === "undefined") return true;
  return isTauriAvailable();
}

function getUnsupportedRuntimeResult() {
  return {
    output: "",
    errors: "Desktop kubectl is unavailable outside the Tauri runtime.",
    code: 1,
  };
}

async function runBrowserKubectlFallback(
  args: string[],
  options?: KubectlOptions,
): Promise<{ output: string; errors: string; code?: number }> {
  const invoke = getBrowserInvoke();
  if (!invoke) {
    throw new Error("Desktop kubectl is unavailable outside the Tauri runtime.");
  }
  const result = await invoke("rozoom:kubectl-proxy", {
    args,
    clusterId: options?.clusterId ?? null,
  });
  if (typeof result === "string") {
    return { output: result, errors: "", code: 0 };
  }
  const code = typeof result.code === "number" ? result.code : 0;
  const errors = code !== 0 && typeof result.errors === "string" ? result.errors : "";
  return {
    output: typeof result.output === "string" ? result.output : "",
    errors,
    code,
  };
}

function toAbortError() {
  return new DOMException("Kubectl request aborted", "AbortError");
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw toAbortError();
  }
}

function extractCloseCode(event: unknown): number {
  if (typeof event === "object" && event !== null && "code" in event) {
    const code = (event as { code?: unknown }).code;
    if (typeof code === "number" && Number.isFinite(code)) return code;
  }
  return 0;
}

function isCoalescibleReadCommand(args: string[], signal?: AbortSignal) {
  if (signal) return false;
  if (args.length === 0) return false;
  return args[0] === "get";
}

function isWatchCommand(args: string[]) {
  return args.some((arg) => arg === "--watch" || arg === "--watch-only" || arg === "-w");
}

function clampBudgetValue(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

function drainKubectlQueue(kind: "exec" | "watch") {
  const queue = kind === "watch" ? kubectlWatchQueue : kubectlExecQueue;
  const active = kind === "watch" ? activeKubectlWatches : activeKubectlExecs;
  const limit =
    kind === "watch"
      ? kubectlExecutionBudget.maxConcurrentWatches
      : kubectlExecutionBudget.maxConcurrentExecs;

  if (active >= limit) return;
  const next = queue.shift();
  next?.();
}

async function runKubectlBudgeted<T>(
  kind: "exec" | "watch",
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  abortIfNeeded(signal);

  return new Promise<T>((resolve, reject) => {
    let started = false;
    const queue = kind === "watch" ? kubectlWatchQueue : kubectlExecQueue;
    const getActive = () => (kind === "watch" ? activeKubectlWatches : activeKubectlExecs);
    const incrementActive = () => {
      if (kind === "watch") {
        activeKubectlWatches += 1;
      } else {
        activeKubectlExecs += 1;
      }
    };
    const decrementActive = () => {
      if (kind === "watch") {
        activeKubectlWatches = Math.max(0, activeKubectlWatches - 1);
      } else {
        activeKubectlExecs = Math.max(0, activeKubectlExecs - 1);
      }
    };

    const start = () => {
      started = true;
      signal?.removeEventListener("abort", onAbort);
      incrementActive();
      void task()
        .then(resolve, reject)
        .finally(() => {
          decrementActive();
          drainKubectlQueue(kind);
        });
    };

    const onAbort = () => {
      if (started) return;
      const index = queue.indexOf(start);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      reject(toAbortError());
    };

    const limit =
      kind === "watch"
        ? kubectlExecutionBudget.maxConcurrentWatches
        : kubectlExecutionBudget.maxConcurrentExecs;

    if (getActive() < limit) {
      start();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    queue.push(start);
  });
}

export function getKubectlExecutionBudget(): KubectlExecutionBudget {
  return {
    maxConcurrentExecs: kubectlExecutionBudget.maxConcurrentExecs,
    maxConcurrentWatches: kubectlExecutionBudget.maxConcurrentWatches,
  };
}

export function setKubectlExecutionBudget(nextBudget: Partial<KubectlExecutionBudget>) {
  kubectlExecutionBudget = {
    maxConcurrentExecs: clampBudgetValue(
      nextBudget.maxConcurrentExecs ?? kubectlExecutionBudget.maxConcurrentExecs,
      DEFAULT_KUBECTL_EXECUTION_BUDGET.maxConcurrentExecs,
    ),
    maxConcurrentWatches: clampBudgetValue(
      nextBudget.maxConcurrentWatches ?? kubectlExecutionBudget.maxConcurrentWatches,
      DEFAULT_KUBECTL_EXECUTION_BUDGET.maxConcurrentWatches,
    ),
  };
  drainKubectlQueue("exec");
  drainKubectlQueue("watch");
}

export function resetKubectlExecutionBudget() {
  kubectlExecutionBudget = { ...DEFAULT_KUBECTL_EXECUTION_BUDGET };
}

function withReadRequestTimeout(args: string[]) {
  if (args[0] !== "get") return args;
  if (isWatchCommand(args)) return args;
  if (args.some((arg) => arg.startsWith("--request-timeout="))) return args;
  return [...args, DEFAULT_READ_REQUEST_TIMEOUT];
}

async function logKubectlErrorThrottled(message: string) {
  const normalized = message.trim();
  if (!normalized) return;
  if (isExpectedClusterProbeError(normalized)) return;
  const now = Date.now();
  for (const [key, loggedAt] of recentKubectlErrorLogs.entries()) {
    if (now - loggedAt > KUBECTL_ERROR_LOG_WINDOW_MS) {
      recentKubectlErrorLogs.delete(key);
    }
  }
  if (recentKubectlErrorLogs.has(normalized)) return;
  recentKubectlErrorLogs.set(normalized, now);
  await logError(message);
}

function buildKubectlFailureMessage(
  args: string[],
  result: KubectlExecResult,
  options?: KubectlOptions,
) {
  const source = options?.source?.trim() ? ` source=${options.source.trim()}` : "";
  const clusterId = options?.clusterId?.trim() ? ` cluster=${options.clusterId.trim()}` : "";
  const stderr = result.stderr.trim() || "<empty stderr>";
  return `kubectl command failed:${source}${clusterId} code=${result.code} args="${args.join(" ")}" stderr="${stderr}"`;
}

function toReadRequestKey(clusterId: string | undefined, args: string[]) {
  const clusterKeyPart = clusterId?.trim() || "__default_cluster__";
  return `${clusterKeyPart}::${args.join("\u241f")}`;
}

function redactKubectlArgs(args: string[]) {
  return args.map((arg, index) => {
    if (index > 0 && args[index - 1] === "--kubeconfig") return "<redacted>";
    return arg;
  });
}

async function executeCommandWithAbort(
  command: Command<string>,
  signal?: AbortSignal,
): Promise<KubectlExecResult> {
  abortIfNeeded(signal);
  let stdout = "";
  let stderr = "";
  let closeCode = 0;
  let resolveClose: (() => void) | null = null;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  command.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  command.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  command.on("close", (event) => {
    closeCode = extractCloseCode(event);
    resolveClose?.();
  });

  const child = await command.spawn();
  const abort = async () => {
    try {
      await child.kill();
    } catch {
      // ignore dead child
    }
  };
  const onAbort = () => {
    void abort();
    resolveClose?.();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await closePromise;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  abortIfNeeded(signal);
  return {
    code: closeCode,
    stdout,
    stderr,
  };
}

export async function kubectlRawFront(
  args: string,
  options?: KubectlOptions,
): Promise<{ output: string; errors: string; code?: number }> {
  if (getBrowserInvoke()) {
    return runBrowserKubectlFallback(withReadRequestTimeout(args.trim().split(/\s+/)), options);
  }
  if (!canUseDesktopKubectlRuntime()) {
    return getUnsupportedRuntimeResult();
  }
  let errors = "";
  let output = "";
  let splitArgs = withReadRequestTimeout(args.trim().split(/\s+/));

  if (options?.clusterId) {
    const appLocalDataDirPath = await appDataDir();
    const safeId = clusterKey(options.clusterId);
    const kubeconfigPath = `${appLocalDataDirPath}/${CONFIG_DIR}/${safeId}.yaml`;
    splitArgs = ["--kubeconfig", kubeconfigPath, ...splitArgs];
  }

  const command = Command.sidecar("binaries/rozoom-kubectl", splitArgs);
  const debugEnabled = isRuntimeDebugEnabled("kubectl");
  const startedAt = Date.now();
  if (debugEnabled) {
    void writeRuntimeDebugLog("kubectl", "exec_start", {
      clusterId: options?.clusterId ?? null,
      source: options?.source ?? null,
      args: redactKubectlArgs(splitArgs),
      kind: isWatchCommand(splitArgs) ? "watch" : "exec",
      budget: getKubectlExecutionBudget(),
    });
  }
  const result = await runKubectlBudgeted(
    isWatchCommand(splitArgs) ? "watch" : "exec",
    () => executeCommandWithAbort(command, options?.signal),
    options?.signal,
  );

  // Kubectl sometimes prints warnings into stderr even with exit code 0.
  // Treat as "error" only when exit code is non-zero.
  if (result.code !== 0 && result.stderr.length > 0) {
    const shouldSuppressCommandUnavailable =
      options?.allowCommandUnavailable && isCommandUnavailableProbeError(result.stderr);
    if (!shouldSuppressCommandUnavailable) {
      await logKubectlErrorThrottled(buildKubectlFailureMessage(splitArgs, result, options));
    }
    errors = `[ERROR] [${new Date().toISOString()}]: ${result.stderr}`;
  }

  if (result.stdout.length > 0) {
    output = result.stdout;
  }

  if (debugEnabled) {
    void writeRuntimeDebugLog("kubectl", "exec_finish", {
      clusterId: options?.clusterId ?? null,
      source: options?.source ?? null,
      args: redactKubectlArgs(splitArgs),
      kind: isWatchCommand(splitArgs) ? "watch" : "exec",
      durationMs: Date.now() - startedAt,
      code: result.code,
      stdoutBytes: result.stdout.length,
      stderrBytes: result.stderr.length,
    });
  }

  {
    const splitForNotify = args.trim().split(/\s+/);
    if (options?.notify || isUserFacingCommand(splitForNotify)) {
      emitCliNotification({
        tool: "kubectl",
        args: splitForNotify,
        success: result.code === 0,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  // If no stdout but there is stderr (and code==0), keep it as errors? -> no, keep output empty.
  return { output, errors, code: result.code };
}

export async function kubectlRawArgsFront(
  args: string[],
  options?: KubectlOptions,
): Promise<{ output: string; errors: string; code?: number }> {
  const dedupeKey = isCoalescibleReadCommand(args, options?.signal)
    ? toReadRequestKey(options?.clusterId, args)
    : null;
  if (dedupeKey) {
    const inFlight = kubectlReadInFlight.get(dedupeKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const request = (async () => {
    if (getBrowserInvoke()) {
      return runBrowserKubectlFallback(withReadRequestTimeout([...args]), options);
    }
    if (!canUseDesktopKubectlRuntime()) {
      return getUnsupportedRuntimeResult();
    }
    let errors = "";
    let output = "";
    let finalArgs = withReadRequestTimeout([...args]);

    if (options?.clusterId) {
      const appLocalDataDirPath = await appDataDir();
      const safeId = clusterKey(options.clusterId);
      const kubeconfigPath = `${appLocalDataDirPath}/${CONFIG_DIR}/${safeId}.yaml`;
      finalArgs = ["--kubeconfig", kubeconfigPath, ...finalArgs];
    }

    const command = Command.sidecar("binaries/rozoom-kubectl", finalArgs);
    const debugEnabled = isRuntimeDebugEnabled("kubectl");
    const startedAt = Date.now();
    if (debugEnabled) {
      void writeRuntimeDebugLog("kubectl", "exec_start", {
        clusterId: options?.clusterId ?? null,
        source: options?.source ?? null,
        args: redactKubectlArgs(finalArgs),
        kind: isWatchCommand(finalArgs) ? "watch" : "exec",
        budget: getKubectlExecutionBudget(),
        coalescedRead: Boolean(dedupeKey),
      });
    }
    const result = await runKubectlBudgeted(
      isWatchCommand(finalArgs) ? "watch" : "exec",
      () => executeCommandWithAbort(command, options?.signal),
      options?.signal,
    );

    if (result.code !== 0 && result.stderr.length > 0) {
      const shouldSuppressCommandUnavailable =
        options?.allowCommandUnavailable && isCommandUnavailableProbeError(result.stderr);
      if (!shouldSuppressCommandUnavailable) {
        await logKubectlErrorThrottled(buildKubectlFailureMessage(finalArgs, result, options));
      }
      errors = `[ERROR] [${new Date().toISOString()}]: ${result.stderr}`;
    }

    if (result.stdout.length > 0) {
      output = result.stdout;
    }

    if (debugEnabled) {
      void writeRuntimeDebugLog("kubectl", "exec_finish", {
        clusterId: options?.clusterId ?? null,
        source: options?.source ?? null,
        args: redactKubectlArgs(finalArgs),
        kind: isWatchCommand(finalArgs) ? "watch" : "exec",
        durationMs: Date.now() - startedAt,
        code: result.code,
        stdoutBytes: result.stdout.length,
        stderrBytes: result.stderr.length,
        coalescedRead: Boolean(dedupeKey),
      });
    }

    if (options?.notify || isUserFacingCommand(args)) {
      emitCliNotification({
        tool: "kubectl",
        args: [...args],
        success: result.code === 0,
        durationMs: Date.now() - startedAt,
      });
    }

    return { output, errors, code: result.code };
  })();

  if (!dedupeKey) {
    return request;
  }

  kubectlReadInFlight.set(dedupeKey, request);
  try {
    return await request;
  } finally {
    if (kubectlReadInFlight.get(dedupeKey) === request) {
      kubectlReadInFlight.delete(dedupeKey);
    }
  }
}

export async function kubectlJson<T = unknown>(
  cmd: string,
  options?: KubectlOptions,
): Promise<T | string> {
  const result = await kubectlRawFront(`${cmd} -o json`, options);

  if (result.errors.length > 0) {
    if (!isExpectedClusterProbeError(result.errors)) {
      await logError(`Failed to execute kubectl command "${cmd}": ${result.errors}`);
    }
    return result.errors;
  }

  try {
    return JSON.parse(result.output) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown JSON parse error";
    await logError(`Failed to parse kubectl JSON output for "${cmd}": ${msg}`);
    return `Failed to parse kubectl JSON output for "${cmd}": ${msg}`;
  }
}

type KubectlStreamHandlers = {
  onStdoutData?: (chunk: string) => void;
  onStderrData?: (chunk: string) => void;
  onClose?: (event: unknown) => void;
  onError?: (error: unknown) => void;
};

export type KubectlStreamProcess = {
  child: Child;
  stop: () => Promise<void>;
};

export async function kubectlStreamArgsFront(
  args: string[],
  options?: KubectlOptions,
  handlers: KubectlStreamHandlers = {},
): Promise<KubectlStreamProcess> {
  if (!canUseDesktopKubectlRuntime()) {
    throw new Error("Desktop kubectl streaming is unavailable outside the Tauri runtime.");
  }
  let finalArgs = [...args];

  if (options?.clusterId) {
    const appLocalDataDirPath = await appDataDir();
    const safeId = clusterKey(options.clusterId);
    const kubeconfigPath = `${appLocalDataDirPath}/${CONFIG_DIR}/${safeId}.yaml`;
    finalArgs = ["--kubeconfig", kubeconfigPath, ...finalArgs];
  }

  const command = Command.sidecar("binaries/rozoom-kubectl", finalArgs);

  command.stdout.on("data", (chunk) => {
    handlers.onStdoutData?.(chunk);
  });
  command.stderr.on("data", (chunk) => {
    handlers.onStderrData?.(chunk);
  });
  command.on("close", (event) => {
    handlers.onClose?.(event);
  });
  command.on("error", (error) => {
    handlers.onError?.(error);
  });

  return runKubectlBudgeted(
    "watch",
    async () => {
      const child = await command.spawn();
      const signal = options?.signal;
      if (signal?.aborted) {
        await child.kill().catch(() => undefined);
        throw toAbortError();
      }
      const onAbort = () => {
        void child.kill().catch(() => undefined);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      return {
        child,
        stop: async () => {
          try {
            await child.kill();
          } catch {
            // Ignore cleanup errors for dead processes.
          } finally {
            signal?.removeEventListener("abort", onAbort);
          }
        },
      };
    },
    options?.signal,
  );
}
