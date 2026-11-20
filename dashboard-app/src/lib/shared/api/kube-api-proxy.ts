import { appDataDir } from "@tauri-apps/api/path";
import type { Child, Command, IOPayload } from "@tauri-apps/plugin-shell";
import { APP_PROXY_REJECT_METHODS } from "$shared/lib/readonly-guard";
import { spawnCli } from "./cli";

const CONFIG_DIR = "configs";
const LOCALHOST_HOST = "127.0.0.1";
const READY_PATTERN = /Starting to serve on 127\.0\.0\.1:(\d+)/;

type ProxySession = {
  command: Command<IOPayload> | null;
  child: Child | null;
  refCount: number;
  ready: Promise<string>;
  resolveReady: (baseUrl: string) => void;
  rejectReady: (error: Error) => void;
  baseUrl: string | null;
  isRunning: boolean;
};

const activeProxies = new Map<string, ProxySession>();

// A stopped proxy reports its exit later, often after a newer proxy for the same cluster
// took its place. Each session forgets only itself; otherwise the newer proxy drops out of
// the registry, keeps running with nobody to stop it, and the next request starts another.
function forgetSession(clusterId: string, session: ProxySession) {
  if (activeProxies.get(clusterId) === session) activeProxies.delete(clusterId);
}

async function stopSessionProcess(session: ProxySession) {
  session.isRunning = false;
  try {
    await session.child?.kill();
  } catch {
    // ignore shutdown errors
  }
}

function createDeferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<string>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { ready, resolve, reject };
}

function getKubeconfigPath(appLocalDataDirPath: string, clusterId: string) {
  return `${appLocalDataDirPath}/${CONFIG_DIR}/${clusterId}.yaml`;
}

export async function acquireKubeApiProxy(clusterId: string): Promise<string> {
  const existing = activeProxies.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    return existing.baseUrl ?? existing.ready;
  }

  const { ready, resolve, reject } = createDeferred();
  const appLocalDataDirPath = await appDataDir();
  const kubeconfigPath = getKubeconfigPath(appLocalDataDirPath, clusterId);

  const args = [
    "proxy",
    "--kubeconfig",
    kubeconfigPath,
    // The app only GETs and watches through this proxy. Refusing every writing method
    // here is what lets the read-only guard allow `kubectl proxy` for this caller; the
    // guard trusts exactly this flag and nothing else.
    APP_PROXY_REJECT_METHODS,
    "--port=0",
    "--address",
    LOCALHOST_HOST,
    "--accept-hosts",
    "^127\\.0\\.0\\.1$,^localhost$",
  ];

  const session: ProxySession = {
    command: null,
    child: null,
    refCount: 1,
    ready,
    resolveReady: resolve,
    rejectReady: reject,
    baseUrl: null,
    isRunning: false,
  };

  activeProxies.set(clusterId, session);

  try {
    const { command, child } = await spawnCli("kubectl", args, {
      onStdoutLine: (line) => {
        if (session.baseUrl) return;
        const match = line.match(READY_PATTERN);
        if (!match) return;
        session.baseUrl = `http://${LOCALHOST_HOST}:${match[1]}`;
        session.isRunning = true;
        session.resolveReady(session.baseUrl);
      },
      onStderrLine: (line) => {
        if (session.baseUrl) return;
        const message = line.trim();
        if (message) {
          session.rejectReady(new Error(message));
        }
      },
      onClose: () => {
        session.isRunning = false;
        if (!session.baseUrl) {
          session.rejectReady(new Error("kubectl proxy closed before becoming ready"));
        }
        forgetSession(clusterId, session);
      },
      onError: (error) => {
        session.isRunning = false;
        session.rejectReady(new Error(String(error)));
        forgetSession(clusterId, session);
      },
    });

    session.command = command;
    session.child = child;
    return await session.ready;
  } catch (error) {
    // A start that failed after the process was spawned (an early stderr line) still
    // leaves kubectl running: stop it, since nothing else holds it any more.
    forgetSession(clusterId, session);
    await stopSessionProcess(session);
    throw error;
  }
}

export async function releaseKubeApiProxy(clusterId: string): Promise<void> {
  const session = activeProxies.get(clusterId);
  if (!session) return;

  session.refCount -= 1;
  if (session.refCount > 0) return;

  forgetSession(clusterId, session);
  await stopSessionProcess(session);
}

export function getActiveKubeApiProxyCount() {
  return activeProxies.size;
}
