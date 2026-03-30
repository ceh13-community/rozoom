import { type IOPayload, type Child, type Command as TauriCommand } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";
import { writable, get, readonly } from "svelte/store";
import { spawnCli } from "$shared/api/cli";
import {
  trackPortForwardStartAttempt,
  trackPortForwardStartResult,
  trackPortForwardStopAttempt,
  trackPortForwardStopResult,
} from "$shared/lib/port-forward-telemetry";

export interface PortForwardProcess {
  command: TauriCommand<IOPayload>;
  child: Child;
  isRunning: boolean;
  localPort: number;
  remotePort: number;
  namespace: string;
  resource: string;
  clusterId: string;
  startedAt: number;
  lastHeartbeatAt: number | null;
  lastMessage: string | null;
  lastError: string | null;
  closedAt: number | null;
}

type ActiveForwardsState = Partial<Record<string, PortForwardProcess>>;

const activeForwards = writable<ActiveForwardsState>({});
export const activePortForwards = readonly(activeForwards);
const CONFIG_DIR = "configs";
const pendingLocalPorts = new Set<number>();

function updateForward(
  uniqueKey: string,
  updater: (current: PortForwardProcess) => PortForwardProcess,
) {
  activeForwards.update((state) => {
    const existing = state[uniqueKey];
    if (!existing) return state;
    return {
      ...state,
      [uniqueKey]: updater(existing),
    };
  });
}

type StartArgs = {
  namespace: string;
  resource: string;
  remotePort: number;
  localPort?: number;
  clusterId: string;
  uniqueKey: string;
};

export async function startPortForward(
  startArgs: StartArgs,
): Promise<{ success: boolean; error?: string }> {
  trackPortForwardStartAttempt({
    uniqueKey: startArgs.uniqueKey,
    clusterId: startArgs.clusterId,
    namespace: startArgs.namespace,
    resource: startArgs.resource,
  });
  const state = get(activeForwards);
  const current = state[startArgs.uniqueKey];

  if (current && current.isRunning) {
    trackPortForwardStartResult({
      uniqueKey: startArgs.uniqueKey,
      success: false,
      reason: "duplicate",
      clusterId: startArgs.clusterId,
      namespace: startArgs.namespace,
      resource: startArgs.resource,
    });
    return { success: false, error: "Port-forward already running for this key" };
  }

  const localPort = startArgs.localPort ?? startArgs.remotePort;
  if (pendingLocalPorts.has(localPort)) {
    trackPortForwardStartResult({
      uniqueKey: startArgs.uniqueKey,
      success: false,
      reason: "error",
      clusterId: startArgs.clusterId,
      namespace: startArgs.namespace,
      resource: startArgs.resource,
    });
    return {
      success: false,
      error: `Local port ${localPort} is already in use by another running port-forward.`,
    };
  }
  const runningOnSameLocalPort = Object.entries(state).find(([key, proc]) => {
    if (!proc || !proc.isRunning) return false;
    if (key === startArgs.uniqueKey) return false;
    return proc.localPort === localPort;
  });
  if (runningOnSameLocalPort) {
    trackPortForwardStartResult({
      uniqueKey: startArgs.uniqueKey,
      success: false,
      reason: "error",
      clusterId: startArgs.clusterId,
      namespace: startArgs.namespace,
      resource: startArgs.resource,
    });
    return {
      success: false,
      error: `Local port ${localPort} is already in use by another running port-forward.`,
    };
  }
  pendingLocalPorts.add(localPort);

  try {
    const appLocalDataDirPath = await appDataDir();
    const kubeconfigPath = `${appLocalDataDirPath}/${CONFIG_DIR}/${startArgs.clusterId}.yaml`;

    const args = [
      "port-forward",
      "-n",
      startArgs.namespace,
      startArgs.resource,
      `${localPort}:${startArgs.remotePort}`,
      "--kubeconfig",
      kubeconfigPath,
      "--address",
      "127.0.0.1",
      "--v=2",
    ];

    let ready = false;
    let lastErr: string | undefined;

    const { command, child } = await spawnCli("kubectl", args, {
      onStdoutLine: (line) => {
        if (line.includes("Forwarding from")) ready = true;
        const trimmed = line.trim();
        updateForward(startArgs.uniqueKey, (current) => ({
          ...current,
          lastHeartbeatAt: Date.now(),
          lastMessage: trimmed || current.lastMessage,
        }));
        console.log("[kubectl]", line.trim());
      },
      onStderrLine: (line) => {
        lastErr = line;
        const trimmed = line.trim();
        updateForward(startArgs.uniqueKey, (current) => ({
          ...current,
          lastHeartbeatAt: Date.now(),
          lastError: trimmed || current.lastError,
          lastMessage: trimmed || current.lastMessage,
        }));
        console.error("[kubectl]", line.trim());
      },
      onClose: (e) => {
        console.warn("[kubectl] port-forward closed:", e);
        updateForward(startArgs.uniqueKey, (current) => ({
          ...current,
          isRunning: false,
          closedAt: Date.now(),
          lastMessage: "Port-forward closed.",
        }));
      },
      onError: (e) => {
        const message = String(e);
        updateForward(startArgs.uniqueKey, (current) => ({
          ...current,
          lastHeartbeatAt: Date.now(),
          lastError: message,
          lastMessage: message,
        }));
        console.error("[kubectl] port-forward error:", e);
      },
    });

    activeForwards.update((processes) => ({
      ...processes,
      [startArgs.uniqueKey]: {
        command,
        child,
        isRunning: true,
        localPort,
        remotePort: startArgs.remotePort,
        namespace: startArgs.namespace,
        resource: startArgs.resource,
        clusterId: startArgs.clusterId,
        startedAt: Date.now(),
        lastHeartbeatAt: null,
        lastMessage: "Starting port-forward...",
        lastError: null,
        closedAt: null,
      },
    }));

    const started = await waitFor(() => ready, 5000);

    if (!started) {
      try {
        await child.kill();
      } catch {
        // Ignore timeout cleanup errors.
      }
      updateForward(startArgs.uniqueKey, (current) => ({
        ...current,
        isRunning: false,
        closedAt: Date.now(),
        lastError: lastErr ?? "Port-forward not ready (timeout)",
        lastMessage: "Port-forward not ready (timeout)",
      }));
      trackPortForwardStartResult({
        uniqueKey: startArgs.uniqueKey,
        success: false,
        reason: "timeout",
        clusterId: startArgs.clusterId,
        namespace: startArgs.namespace,
        resource: startArgs.resource,
      });
      return { success: false, error: lastErr ?? "Port-forward not ready (timeout)" };
    }

    trackPortForwardStartResult({
      uniqueKey: startArgs.uniqueKey,
      success: true,
      clusterId: startArgs.clusterId,
      namespace: startArgs.namespace,
      resource: startArgs.resource,
    });
    return { success: true };
  } catch (err) {
    trackPortForwardStartResult({
      uniqueKey: startArgs.uniqueKey,
      success: false,
      reason: "error",
      clusterId: startArgs.clusterId,
      namespace: startArgs.namespace,
      resource: startArgs.resource,
    });
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    pendingLocalPorts.delete(localPort);
  }
}

function waitFor(cond: () => boolean, timeoutMs: number) {
  const start = Date.now();
  return new Promise<boolean>((resolve) => {
    const t = setInterval(() => {
      if (cond()) {
        clearInterval(t);
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve(false);
      }
    }, 50);
  });
}

export async function stopPortForward(uniqueKey: string): Promise<void> {
  const proc = get(activeForwards)[uniqueKey];

  if (!proc || !proc.isRunning) return;
  trackPortForwardStopAttempt({
    uniqueKey,
    clusterId: proc.clusterId,
    namespace: proc.namespace,
    resource: proc.resource,
  });

  try {
    await proc.child.kill();
    trackPortForwardStopResult({
      uniqueKey,
      success: true,
      clusterId: proc.clusterId,
      namespace: proc.namespace,
      resource: proc.resource,
    });
  } catch (error) {
    trackPortForwardStopResult({
      uniqueKey,
      success: false,
      clusterId: proc.clusterId,
      namespace: proc.namespace,
      resource: proc.resource,
    });
    throw error;
  } finally {
    updateForward(uniqueKey, (current) => ({
      ...current,
      isRunning: false,
      closedAt: Date.now(),
      lastMessage: "Stopped by user.",
    }));
  }
}
