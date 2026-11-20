// eslint-disable-next-line no-restricted-imports -- same legacy FSD import as pod-debug-session
import { openPodNetworkDebugShellModal } from "$features/shell";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { lastStderrLine } from "$shared/lib/kubectl-connectivity";
import type { PodItem } from "$shared/model/clusters";

/**
 * Network tools (dig, curl, nc, tcpdump, mtr, iperf3). Pinned to the digest of the v0.16 index,
 * so a moved tag cannot change what runs in the pod. About 210 MB, pulled on first use.
 */
export const NETWORK_DEBUG_IMAGE =
  "nicolaka/netshoot:v0.16@sha256:b09d9b21381f47a79b3cbcb30da25266dc17186ea00ae65e99fdc51396f48e70";
/**
 * The baseline profile adds no capability of its own. Explicit because the default profile of
 * the bundled kubectl is "general", which adds SYS_PTRACE.
 */
const NETWORK_DEBUG_PROFILE = "baseline";
/**
 * NET_RAW only: dig, curl, nc, ping, mtr and tcpdump need nothing more. NET_ADMIN would also
 * let the session change the pod's routes and iptables. kubectl merges this into the debug
 * container and it replaces any capability list a profile would add.
 */
export const NETWORK_DEBUG_CUSTOM_SPEC = {
  securityContext: { capabilities: { add: ["NET_RAW"] } },
};
/** The debug container stops by itself after this, even if the app never stops it. */
const NETWORK_DEBUG_TTL_SECONDS = 3600;
const START_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
const PID_FILE = "/tmp/rozoom-debug-session.pid";
/** Waiting reasons that will not resolve by waiting longer. */
const FAILED_WAITING_REASONS = new Set([
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
]);

export type PodNetworkDebugTarget = {
  clusterId: string;
  pod: Partial<PodItem>;
};

export function buildNetworkDebugContainerName() {
  return `rozoom-netshoot-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * An ephemeral container in the pod itself, not a copy: it shares the pod's network, so
 * dig, curl and tcpdump see what the pod sees. No --target, so it gets its own process
 * namespace and the stop command can never signal the app's processes.
 */
export function buildNetworkDebugStartArgs(
  name: string,
  namespace: string,
  container: string,
  customSpecPath: string,
) {
  return [
    "debug",
    `pod/${name}`,
    "-n",
    namespace,
    `--image=${NETWORK_DEBUG_IMAGE}`,
    `--container=${container}`,
    `--profile=${NETWORK_DEBUG_PROFILE}`,
    `--custom=${customSpecPath}`,
    "--",
    "sh",
    "-c",
    `sleep ${NETWORK_DEBUG_TTL_SECONDS} & echo $! > ${PID_FILE}; wait`,
  ];
}

/** Ends the sleep, so the container exits. Kubernetes keeps it listed as terminated. */
export function buildNetworkDebugStopArgs(name: string, namespace: string, container: string) {
  return [
    "exec",
    "-i",
    "--namespace",
    namespace,
    "-c",
    container,
    name,
    "--",
    "sh",
    "-c",
    `kill "$(cat ${PID_FILE})"`,
  ];
}

type ContainerState = {
  running?: unknown;
  terminated?: { reason?: string; message?: string };
  waiting?: { reason?: string; message?: string };
};

export type EphemeralContainerState =
  | { kind: "running" }
  | { kind: "pending" }
  | { kind: "failed"; reason: string };

/** State of one ephemeral container from `kubectl get pod -o json`. */
export function readEphemeralContainerState(
  podJson: string,
  container: string,
): EphemeralContainerState {
  let statuses: Array<{ name?: string; state?: ContainerState }> = [];
  try {
    const parsed = JSON.parse(podJson) as {
      status?: { ephemeralContainerStatuses?: Array<{ name?: string; state?: ContainerState }> };
    };
    statuses = parsed.status?.ephemeralContainerStatuses ?? [];
  } catch {
    return { kind: "pending" };
  }
  const state = statuses.find((status) => status.name === container)?.state;
  if (!state) return { kind: "pending" };
  if (state.running) return { kind: "running" };
  if (state.terminated) {
    const { reason, message } = state.terminated;
    return { kind: "failed", reason: [reason, message].filter(Boolean).join(": ") || "exited" };
  }
  const waitingReason = state.waiting?.reason;
  if (waitingReason && FAILED_WAITING_REASONS.has(waitingReason)) {
    const message = state.waiting?.message;
    return { kind: "failed", reason: message ? `${waitingReason}: ${message}` : waitingReason };
  }
  return { kind: "pending" };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A refused start: a plain sentence, with what kubectl wrote kept as the detail. */
export class NetworkDebugRefusal extends Error {
  readonly detail: string | null;

  constructor(message: string, detail: string | null) {
    super(message);
    this.name = "NetworkDebugRefusal";
    this.detail = detail;
  }
}

/**
 * A Pod Security level that forbids the container becomes one plain sentence. Both baseline
 * and restricted forbid NET_RAW (restricted also asks for non-root, seccomp and no privilege
 * escalation), so only the privileged level allows network debug. kubectl's own line stays
 * as the detail. Any other refusal is passed on as kubectl's last line.
 *
 * Only the last stderr line is shown: earlier lines can be a credential plugin's own output,
 * such as a kubelogin sign-in URL or device code, which must not end up in a toast.
 */
export function describeNetworkDebugRefusal(
  stderr: string,
  namespace: string,
): NetworkDebugRefusal {
  const kubectlLine = lastStderrLine(stderr) || stderr.trim();
  const level = kubectlLine.match(/violates PodSecurity "([a-z]+):/)?.[1];
  if (!level) return new NetworkDebugRefusal(kubectlLine, null);
  return new NetworkDebugRefusal(
    `Namespace ${namespace} does not allow network debug: its Pod Security level is "${level}", and network debug needs the "privileged" level for the NET_RAW capability that tcpdump, ping and mtr use.`,
    kubectlLine,
  );
}

/** kubectl debug --custom reads a file, so the spec is written to the app data folder. */
async function writeCustomSpecFile(): Promise<{ path: string; remove: () => Promise<void> }> {
  const { writeTextFile, remove } = await import("@tauri-apps/plugin-fs");
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  // join, not "/": the folder uses backslashes on Windows.
  const path = await join(
    await appDataDir(),
    `network-debug-${Math.random().toString(36).slice(2, 10)}.json`,
  );
  await writeTextFile(path, JSON.stringify(NETWORK_DEBUG_CUSTOM_SPEC));
  return { path, remove: () => remove(path).catch(() => undefined) };
}

/** Adds the network debug container to the pod and opens a shell in it once it runs. */
export async function startPodNetworkDebugSession({ clusterId, pod }: PodNetworkDebugTarget) {
  const name = pod.metadata?.name.trim();
  const namespace = pod.metadata?.namespace.trim() || "default";
  if (!clusterId || !name) {
    throw new Error("Network debug requires a cluster and a pod name.");
  }

  const container = buildNetworkDebugContainerName();
  const customSpec = await writeCustomSpecFile();
  let started: Awaited<ReturnType<typeof kubectlRawArgsFront>>;
  try {
    started = await kubectlRawArgsFront(
      buildNetworkDebugStartArgs(name, namespace, container, customSpec.path),
      { clusterId },
    );
  } finally {
    await customSpec.remove();
  }
  if (started.errors || started.code !== 0) {
    throw started.errors
      ? describeNetworkDebugRefusal(started.errors, namespace)
      : new Error("Could not add the network debug container.");
  }

  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const result = await kubectlRawArgsFront(["get", "pod", name, "-n", namespace, "-o", "json"], {
      clusterId,
    });
    const state =
      result.code === 0 && !result.errors
        ? readEphemeralContainerState(result.output, container)
        : ({ kind: "pending" } as const);
    if (state.kind === "running") break;
    if (state.kind === "failed") {
      throw new Error(`Network debug container did not start (${state.reason}).`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Network debug container did not start within ${START_TIMEOUT_MS / 1000} s. The image ${NETWORK_DEBUG_IMAGE} may still be downloading; try again in a minute.`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }

  openPodNetworkDebugShellModal(clusterId, pod, {
    container,
    stopArgs: buildNetworkDebugStopArgs(name, namespace, container),
    sessionLabel: `${name} (network debug)`,
    notice: started.warnings ? `kubectl warning: ${started.warnings}` : undefined,
  });
  return { container, namespace, warnings: started.warnings };
}
