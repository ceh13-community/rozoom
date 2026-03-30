import type { PodItem } from "$shared/model/clusters";
import { DEBUG_SHELL_IMAGE_CANDIDATES } from "$shared/config/tooling";

const DEBUG_POD_NAMESPACE = "default";
const DEBUG_POD_SERVICE_ACCOUNT = "cluster-debug-shell";
const DEBUG_POD_CLUSTER_ROLE_BINDING = "cluster-debug-shell-admin";
const DEBUG_POD_IMAGES = DEBUG_SHELL_IMAGE_CANDIDATES;
const DEBUG_POD_TTL_SECONDS = 60 * 60 * 24;
const DEBUG_POD_READY_TIMEOUT_SECONDS = 180;

type PodStatusShape = {
  status?: {
    phase?: string;
    reason?: string;
    message?: string;
    containerStatuses?: Array<{
      state?: {
        waiting?: {
          reason?: string;
          message?: string;
        };
        terminated?: {
          reason?: string;
          message?: string;
        };
      };
    }>;
  };
};

function normalizeNamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parsePodStatus(rawOutput: string): PodStatusShape | null {
  try {
    return JSON.parse(rawOutput) as PodStatusShape;
  } catch {
    return null;
  }
}

export function getDebugPodImages() {
  return [...DEBUG_POD_IMAGES];
}

export function buildDebugPodName(clusterId: string) {
  const normalized = normalizeNamePart(clusterId).slice(0, 34) || "cluster";
  return `debug-pod-${normalized}`;
}

export function buildDebugServiceAccountArgs() {
  return [
    "create",
    "serviceaccount",
    DEBUG_POD_SERVICE_ACCOUNT,
    "--namespace",
    DEBUG_POD_NAMESPACE,
  ];
}

export function buildDebugServiceAccountGetArgs() {
  return ["get", "serviceaccount", DEBUG_POD_SERVICE_ACCOUNT, "--namespace", DEBUG_POD_NAMESPACE];
}

export function buildDebugClusterRoleBindingArgs() {
  return [
    "create",
    "clusterrolebinding",
    DEBUG_POD_CLUSTER_ROLE_BINDING,
    "--clusterrole",
    "cluster-admin",
    "--serviceaccount",
    `${DEBUG_POD_NAMESPACE}:${DEBUG_POD_SERVICE_ACCOUNT}`,
  ];
}

export function buildDebugClusterRoleBindingGetArgs() {
  return ["get", "clusterrolebinding", DEBUG_POD_CLUSTER_ROLE_BINDING];
}

export function buildDebugPodCreateArgs(clusterId: string, image: string = DEBUG_POD_IMAGES[0]) {
  const podName = buildDebugPodName(clusterId);
  const overrides = JSON.stringify({
    spec: {
      serviceAccountName: DEBUG_POD_SERVICE_ACCOUNT,
    },
  });

  return [
    "run",
    podName,
    "--image",
    image,
    "--restart",
    "Never",
    "--namespace",
    DEBUG_POD_NAMESPACE,
    "--overrides",
    overrides,
    "--labels",
    "app.kubernetes.io/name=cluster-debug-shell,app.kubernetes.io/managed-by=rozoom",
    "--command",
    "--",
    "sleep",
    `${DEBUG_POD_TTL_SECONDS}`,
  ];
}

export function buildDebugPodDeleteArgs(clusterId: string) {
  return [
    "delete",
    "pod",
    buildDebugPodName(clusterId),
    "--namespace",
    DEBUG_POD_NAMESPACE,
    "--ignore-not-found=true",
    "--grace-period=0",
    "--force",
  ];
}

export function buildDebugPodExecArgs(clusterId: string, command: string) {
  return [
    "exec",
    "-i",
    "--namespace",
    DEBUG_POD_NAMESPACE,
    buildDebugPodName(clusterId),
    "--",
    "sh",
    "-lc",
    command,
  ];
}

export function buildDebugPodGetArgs(clusterId: string) {
  return [
    "get",
    "pod",
    buildDebugPodName(clusterId),
    "--namespace",
    DEBUG_POD_NAMESPACE,
    "-o",
    "json",
  ];
}

export function buildDebugPodWaitArgs(clusterId: string) {
  return [
    "wait",
    "--for=condition=Ready",
    "pod",
    buildDebugPodName(clusterId),
    "--namespace",
    DEBUG_POD_NAMESPACE,
    `--timeout=${DEBUG_POD_READY_TIMEOUT_SECONDS}s`,
  ];
}

export function parsePodPhase(rawOutput: string): string | null {
  const parsed = parsePodStatus(rawOutput);
  return parsed?.status?.phase ?? null;
}

export function describePodStartupFailure(rawOutput: string): string {
  const parsed = parsePodStatus(rawOutput);
  if (!parsed?.status) return "Debug pod is not ready and status is unavailable.";

  const waitingState = parsed.status.containerStatuses?.find((item) => item.state?.waiting)?.state
    ?.waiting;
  if (waitingState?.reason) {
    const details = waitingState.message ? ` (${waitingState.message})` : "";
    return `Debug pod is waiting: ${waitingState.reason}${details}`;
  }

  const terminatedState = parsed.status.containerStatuses?.find((item) => item.state?.terminated)
    ?.state?.terminated;
  if (terminatedState?.reason) {
    const details = terminatedState.message ? ` (${terminatedState.message})` : "";
    return `Debug pod terminated: ${terminatedState.reason}${details}`;
  }

  if (parsed.status.reason) {
    const details = parsed.status.message ? ` (${parsed.status.message})` : "";
    return `Debug pod status: ${parsed.status.reason}${details}`;
  }

  if (parsed.status.phase) {
    return `Debug pod phase: ${parsed.status.phase}`;
  }

  return "Debug pod is not ready.";
}

/** Well-known sidecar container name patterns. */
const SIDECAR_PATTERNS = [
  /^istio-proxy$/,
  /^envoy$/,
  /^linkerd-proxy$/,
  /^vault-agent/,
  /^filebeat$/,
  /^fluentbit$/,
  /^fluent-bit$/,
  /^datadog-agent$/,
  /^cloudsql-proxy$/,
];

/**
 * Pick the most likely "main" container from a pod spec.
 * Returns the first container whose name doesn't match a known sidecar pattern,
 * or the very first container if all match (better than nothing).
 */
export function pickMainContainer(pod: Partial<PodItem>): string | undefined {
  const containers = pod.spec?.containers as Array<{ name?: string }> | undefined;
  if (!containers || containers.length === 0) return undefined;
  if (containers.length === 1) return containers[0].name ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const main = containers.find((c) => c.name && !SIDECAR_PATTERNS.some((re) => re.test(c.name!)));
  return (main ?? containers[0]).name ?? undefined;
}

export function buildPodShellExecArgs(pod: Partial<PodItem>, command: string, container?: string) {
  const podName = pod.metadata?.name;
  if (!podName) {
    throw new Error("Pod shell requires a pod with a name.");
  }
  const namespace = pod.metadata?.namespace || DEBUG_POD_NAMESPACE;
  const containerArg = container || pickMainContainer(pod);
  const args = ["exec", "-i", "--namespace", namespace];
  if (containerArg) args.push("-c", containerArg);
  args.push(podName, "--", "sh", "-lc", command);
  return args;
}

export function buildPodAttachArgs(pod: Partial<PodItem>, container?: string) {
  const podName = pod.metadata?.name;
  if (!podName) {
    throw new Error("Pod attach requires a pod with a name.");
  }
  const namespace = pod.metadata?.namespace || DEBUG_POD_NAMESPACE;
  const containerArg = container || pickMainContainer(pod);
  const args = ["attach", "-i", "-t", "--namespace", namespace];
  if (containerArg) args.push("-c", containerArg);
  args.push(podName);
  return args;
}

export function getPodSessionInitialCommand(mode: "debug" | "pod-exec" | "pod-attach") {
  if (mode === "debug") return "kubectl get pods -A";
  if (mode === "pod-attach") return "";
  return "pwd";
}

export type DebugCommandCandidate = {
  label: string;
  commands: string[];
  required: boolean;
};

export function getDebugCommandCandidates(): DebugCommandCandidate[] {
  return [
    {
      label: "kubectl version",
      commands: ["kubectl version --client=true", "kubectl version --client"],
      required: true,
    },
    {
      label: "helm version",
      commands: ["helm version --short", "helm version"],
      required: true,
    },
    {
      label: "debug tools",
      commands: [
        'missing=""; for tool in curl jq dig nslookup; do command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"; done; if [ -n "$missing" ]; then echo "Missing tools:$missing"; fi; exit 0',
      ],
      required: false,
    },
  ];
}

export function isImagePullFailure(rawOutput: string): boolean {
  const parsed = parsePodStatus(rawOutput);
  const waitingReason = parsed?.status?.containerStatuses?.find((item) => item.state?.waiting)
    ?.state?.waiting?.reason;

  return waitingReason === "ErrImagePull" || waitingReason === "ImagePullBackOff";
}

export function isDebugPodNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('pods "debug-pod-') && normalized.includes("not found");
}
