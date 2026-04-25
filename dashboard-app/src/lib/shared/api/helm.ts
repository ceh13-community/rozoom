import { appDataDir } from "@tauri-apps/api/path";
import { spawnCli } from "$shared/api/cli";
import { CONFIG_DIR } from "$entities/config/model/appConfig";
import { clusterKey } from "$shared/lib/cluster-key";
import { getClusterNodesNames } from "$shared/api/tauri";
import { emitCliNotification } from "$shared/lib/cli-notification";
import {
  LOCAL_CLUSTER_NODE_NAME_PATTERNS,
  METRICS_SERVER_INSTALL_PROFILES,
  type MetricsServerInstallProfileId,
} from "$shared/config/tooling";

const DEFAULT_NAMESPACE = "kube-state-metrics";
const RELEASE_NAME = "kube-state-metrics";
const REPO_NAME = "prometheus-community";
const REPO_URL = "https://prometheus-community.github.io/helm-charts";
const CHART_NAME = `${REPO_NAME}/kube-state-metrics`;
const METRICS_SERVER_REPO_NAME = "metrics-server";
const METRICS_SERVER_REPO_URL = "https://kubernetes-sigs.github.io/metrics-server/";
const METRICS_SERVER_CHART = `${METRICS_SERVER_REPO_NAME}/metrics-server`;
const METRICS_SERVER_RELEASE = "metrics-server";
const METRICS_SERVER_NAMESPACE = "kube-system";
const NODE_EXPORTER_RELEASE = "prometheus-node-exporter";
const NODE_EXPORTER_NAMESPACE = "monitoring";
const NODE_EXPORTER_CHART = `${REPO_NAME}/prometheus-node-exporter`;
const PLUTO_REPO_NAME = "fairwinds-stable";
const PLUTO_RELEASE = "pluto";
const VELERO_REPO_NAME = "vmware-tanzu";
const VELERO_REPO_URL = "https://vmware-tanzu.github.io/helm-charts";
const VELERO_CHART = `${VELERO_REPO_NAME}/velero`;
const VELERO_RELEASE = "velero";
const VELERO_NAMESPACE = "velero";
const PROM_STACK_RELEASE = "kube-prometheus-stack";
const PROM_STACK_NAMESPACE = "monitoring";
const PROM_STACK_CHART = `${REPO_NAME}/kube-prometheus-stack`;
const KUBESCAPE_REPO_NAME = "kubescape";
const KUBESCAPE_REPO_URL = "https://kubescape.github.io/helm-charts/";
const KUBESCAPE_CHART = `${KUBESCAPE_REPO_NAME}/kubescape-operator`;
const KUBESCAPE_RELEASE = "kubescape-operator";
const KUBESCAPE_NAMESPACE = "kubescape";
const KUBE_BENCH_REPO_NAME = "aquasecurity";
const KUBE_BENCH_RELEASE = "kube-bench";
const KUBE_BENCH_NAMESPACE = "kube-bench";
const TRIVY_OPERATOR_REPO_NAME = "aquasecurity";
const TRIVY_OPERATOR_REPO_URL = "https://aquasecurity.github.io/helm-charts/";
const TRIVY_OPERATOR_RELEASE = "trivy-operator";
const TRIVY_OPERATOR_NAMESPACE = "trivy-system";
const TRIVY_OPERATOR_CHART_CANDIDATES = [`${TRIVY_OPERATOR_REPO_NAME}/trivy-operator`];
const KUBEARMOR_REPO_NAME = "kubearmor";
const KUBEARMOR_REPO_URL = "https://kubearmor.github.io/charts";
const KUBEARMOR_RELEASE = "kubearmor-operator";
const KUBEARMOR_NAMESPACE = "kubearmor";
const KUBEARMOR_CHART_CANDIDATES = [
  `${KUBEARMOR_REPO_NAME}/kubearmor-operator`,
  `${KUBEARMOR_REPO_NAME}/kubearmor`,
];
const MODELARMOR_RELEASE = "modelarmor";
const MODELARMOR_NAMESPACE = "modelarmor";
const MODELARMOR_CHART_CANDIDATES = [`${KUBEARMOR_REPO_NAME}/modelarmor`];
// Must be larger than the longest helm `--timeout` flag we pass (currently
// 10m for installs) plus a comfortable buffer, otherwise the JS-level
// race in runHelmCommand kills the process before helm finishes - even
// when the install itself is progressing. 15m covers 10m helm budget +
// first-image-pull overhead on slow clusters like minikube. Read-only
// helm commands (list, get, repo add) finish in seconds regardless, so
// the bigger ceiling does not slow them down.
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const PRIVILEGED_NAMESPACES = new Set([
  PROM_STACK_NAMESPACE,
  NODE_EXPORTER_NAMESPACE,
  KUBESCAPE_NAMESPACE,
  KUBEARMOR_NAMESPACE,
  TRIVY_OPERATOR_NAMESPACE,
  VELERO_NAMESPACE,
  "falco",
  "keda",
  "opencost",
  "external-secrets",
  "opentelemetry",
  "ingress-nginx",
  "argocd",
  "flux-system",
  "cert-manager",
  "envoy-gateway-system",
]);

type HelmResult = { success: boolean; error?: string };
type HelmCommandResult = HelmResult & { stdout: string; stderr: string; code: number };

type MetricsServerInstallProfile = MetricsServerInstallProfileId | "auto";

function formatHelmError(result: HelmCommandResult, fallback: string): string {
  const values = [result.error, result.stderr, result.stdout]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());

  if (values.length === 0) return fallback;

  const unique = [...new Set(values)];
  return unique.join("\n");
}

async function getKubeconfigPath(clusterId: string): Promise<string> {
  const appLocalDataDirPath = await appDataDir();
  const safeId = clusterKey(clusterId);
  return `${appLocalDataDirPath}/${CONFIG_DIR}/${safeId}.yaml`;
}

async function resolveMetricsServerProfile(
  clusterId: string,
  requested: MetricsServerInstallProfile,
) {
  if (requested !== "auto") return requested;
  try {
    const nodeNames = await getClusterNodesNames(clusterId);
    const isLocalCluster = nodeNames.some((nodeName) =>
      LOCAL_CLUSTER_NODE_NAME_PATTERNS.some((pattern) => pattern.test(nodeName)),
    );
    return isLocalCluster ? "local" : "standard";
  } catch {
    return "standard";
  }
}

async function runKubectl(args: string[]): Promise<HelmCommandResult> {
  let stdout = "";
  let stderr = "";
  let resolveClose: (code: number) => void;
  const startMs = Date.now();
  const closePromise = new Promise<number>((resolve) => {
    resolveClose = resolve;
  });
  const { child } = await spawnCli("kubectl", args, {
    onStdoutLine: (line) => {
      stdout += line;
    },
    onStderrLine: (line) => {
      stderr += line;
    },
    onClose: (e) => {
      const code =
        typeof e === "object" && e !== null && "code" in e ? (e as { code: number }).code : 1;
      resolveClose(code);
    },
    onError: () => {
      resolveClose(1);
    },
  });
  const timer = setTimeout(() => {
    child.kill().catch(() => {});
  }, 15_000);
  const code = await closePromise;
  clearTimeout(timer);
  const durationMs = Date.now() - startMs;
  const error =
    stderr.trim() || (code !== 0 ? stdout.trim() || "kubectl command failed" : undefined);
  emitCliNotification({ tool: "kubectl", args, success: code === 0, durationMs });
  return { success: code === 0, stdout, stderr, code, ...(error && code !== 0 ? { error } : {}) };
}

async function ensurePrivilegedNamespace(clusterId: string, namespace: string): Promise<void> {
  if (!PRIVILEGED_NAMESPACES.has(namespace)) return;
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  await runKubectl(["create", "namespace", namespace, "--kubeconfig", kubeconfigPath]);
  await runKubectl([
    "label",
    "namespace",
    namespace,
    "pod-security.kubernetes.io/enforce=privileged",
    "pod-security.kubernetes.io/audit=privileged",
    "pod-security.kubernetes.io/warn=privileged",
    "--overwrite",
    "--kubeconfig",
    kubeconfigPath,
  ]);
}

async function runHelmCommand(
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  /**
   * Optional sink for a live transcript of the command: banner line plus
   * stdout/stderr chunks as they arrive. Used by panels that show an
   * inline command-console so the user sees progress without tailing
   * external logs.
   */
  onOutput?: (chunk: string) => void,
): Promise<HelmCommandResult> {
  onOutput?.(`$ helm ${args.join(" ")}\n`);
  let stdout = "";
  let stderr = "";
  let resolveClose: ((code: number) => void) | undefined;
  const startMs = Date.now();

  const closePromise = new Promise<number>((resolve) => {
    resolveClose = resolve;
  });

  const { child } = await spawnCli("helm", args, {
    onStdoutLine: (line) => {
      stdout += line;
      onOutput?.(line);
    },
    onStderrLine: (line) => {
      stderr += line;
      onOutput?.(line);
    },
    onClose: (e) => {
      if (typeof e === "object" && e !== null && "code" in e) {
        const v = (e as { code?: unknown }).code;
        resolveClose?.(typeof v === "number" ? v : 0);
        return;
      }
      resolveClose?.(0);
    },
    onError: (e) => {
      stderr += String(e);
    },
  });

  const timeoutPromise = new Promise<number>((resolve) => {
    setTimeout(() => {
      resolve(-1);
    }, timeoutMs);
  });

  const code = await Promise.race([closePromise, timeoutPromise]);
  const durationMs = Date.now() - startMs;

  if (code === -1) {
    try {
      await child.kill();
    } catch {
      // ignore kill errors
    }
    emitCliNotification({ tool: "helm", args, success: false, durationMs });
    return {
      success: false,
      error: `Helm command timed out after ${timeoutMs}ms`,
      stdout,
      stderr,
      code,
    };
  }

  if (code !== 0) {
    emitCliNotification({ tool: "helm", args, success: false, durationMs });
    return {
      success: false,
      error: stderr || stdout || `Helm command failed with code ${code}`,
      stdout,
      stderr,
      code,
    };
  }

  emitCliNotification({ tool: "helm", args, success: true, durationMs });
  return { success: true, stdout, stderr, code };
}

async function runHelm(
  args: string[],
  timeoutMs?: number,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const result = await runHelmCommand(args, timeoutMs, onOutput);
  return result.success
    ? { success: true }
    : { success: false, error: result.error ?? "Helm command failed" };
}

async function ensureHelmRepo(
  repoName: string,
  repoUrl: string,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const addResult = await runHelm(
    ["repo", "add", repoName, repoUrl, "--force-update"],
    undefined,
    onOutput,
  );
  if (!addResult.success) return addResult;

  return runHelm(["repo", "update", repoName], undefined, onOutput);
}

type HelmRelease = {
  name: string;
  namespace: string;
  chart: string;
  status?: string;
};
type HelmRepo = {
  name: string;
  url: string;
};
type HelmHistoryEntry = {
  revision: string;
  updated?: string;
  status?: string;
  chart?: string;
  app_version?: string;
  description?: string;
};

export type HelmListedRelease = HelmRelease;
export type HelmListedRepo = HelmRepo;
export type HelmReleaseHistoryEntry = HelmHistoryEntry;
export type VeleroCloudProvider = "aws" | "azure" | "gcp" | "do" | "hetzner";
export type HelmReleaseLookup = {
  installed: boolean;
  release?: HelmListedRelease;
  error?: string;
};

function isPlutoRelease(release: HelmRelease): boolean {
  const chart = (release.chart || "").toLowerCase();
  const name = (release.name || "").toLowerCase();
  return (
    name === PLUTO_RELEASE ||
    chart.startsWith("pluto") ||
    chart.startsWith(`${PLUTO_REPO_NAME}/pluto`) ||
    chart.includes("/pluto-")
  );
}

function isVeleroRelease(release: HelmRelease): boolean {
  const chart = (release.chart || "").toLowerCase();
  const name = (release.name || "").toLowerCase();
  return (
    name === VELERO_RELEASE ||
    chart.startsWith("velero") ||
    chart.startsWith(`${VELERO_REPO_NAME}/velero`) ||
    chart.includes("/velero-")
  );
}

function isPrometheusStackRelease(release: HelmRelease): boolean {
  const chart = (release.chart || "").toLowerCase();
  const name = (release.name || "").toLowerCase();
  return (
    name === PROM_STACK_RELEASE ||
    chart.startsWith("kube-prometheus-stack") ||
    chart.startsWith(`${REPO_NAME}/kube-prometheus-stack`) ||
    chart.includes("/kube-prometheus-stack-")
  );
}

function isKubescapeRelease(release: HelmRelease): boolean {
  const chart = (release.chart || "").toLowerCase();
  const name = (release.name || "").toLowerCase();
  return (
    name === KUBESCAPE_RELEASE ||
    chart.startsWith("kubescape-operator") ||
    chart.startsWith(`${KUBESCAPE_REPO_NAME}/kubescape-operator`) ||
    chart.includes("/kubescape-operator-")
  );
}

function isKubeBenchRelease(release: HelmRelease): boolean {
  const chart = (release.chart || "").toLowerCase();
  const name = (release.name || "").toLowerCase();
  return (
    name === KUBE_BENCH_RELEASE ||
    chart.startsWith("kube-bench") ||
    chart.startsWith(`${KUBE_BENCH_REPO_NAME}/kube-bench`) ||
    chart.includes("/kube-bench-")
  );
}

function isTrivyOperatorRelease(release: HelmRelease): boolean {
  const chart = (release.chart || "").toLowerCase();
  const name = (release.name || "").toLowerCase();
  return (
    name === TRIVY_OPERATOR_RELEASE ||
    chart.startsWith("trivy-operator") ||
    chart.startsWith(`${TRIVY_OPERATOR_REPO_NAME}/trivy-operator`) ||
    chart.includes("/trivy-operator-")
  );
}

async function resolveReleaseName(clusterId: string, namespace: string): Promise<string | null> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand([
    "list",
    "--namespace",
    namespace,
    "--output",
    "json",
    "--kubeconfig",
    kubeconfigPath,
  ]);

  if (!result.success) return null;

  try {
    const releases = JSON.parse(result.stdout || "[]") as HelmRelease[];
    const match = releases.find((release) => release.chart.startsWith("kube-state-metrics"));
    return match?.name ?? null;
  } catch {
    return null;
  }
}

export async function listHelmReleases(clusterId: string): Promise<{
  releases: HelmListedRelease[];
  error?: string;
}> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand([
    "list",
    "--all-namespaces",
    "--output",
    "json",
    "--kubeconfig",
    kubeconfigPath,
  ]);

  if (!result.success) {
    return { releases: [], error: result.error ?? "Failed to list Helm releases" };
  }

  try {
    const releases = JSON.parse(result.stdout || "[]") as HelmRelease[];
    return { releases };
  } catch (error) {
    return {
      releases: [],
      error: error instanceof Error ? error.message : "Failed to parse Helm releases",
    };
  }
}

export async function listHelmRepos(): Promise<{
  repos: HelmListedRepo[];
  error?: string;
}> {
  const result = await runHelmCommand(["repo", "list", "--output", "json"]);
  if (!result.success) {
    return { repos: [], error: result.error ?? "Failed to list Helm repositories" };
  }

  try {
    const repos = JSON.parse(result.stdout || "[]") as HelmRepo[];
    return { repos };
  } catch (error) {
    return {
      repos: [],
      error: error instanceof Error ? error.message : "Failed to parse Helm repositories",
    };
  }
}

export type HelmChartVersion = {
  name: string;
  version: string;
  appVersion?: string;
};

export async function searchHelmChartVersions(
  chart: string,
  limit = 20,
  options?: { repoName?: string; repoUrl?: string },
): Promise<{ versions: HelmChartVersion[]; error?: string }> {
  const normalized = chart.trim();
  if (!normalized) return { versions: [], error: "Chart name is required" };

  // helm search repo walks the local repo index. If the repo was never added
  // on this machine, search returns 0 results silently. Ensure presence for
  // classic `<repo>/<chart>` refs (OCI refs are not searchable this way).
  const repoName = options?.repoName?.trim();
  const repoUrl = options?.repoUrl?.trim();
  if (!normalized.startsWith("oci://") && repoName && repoUrl) {
    await runHelmCommand(["repo", "add", repoName, repoUrl, "--force-update"]).catch(() => null);
    await runHelmCommand(["repo", "update", repoName]).catch(() => null);
  }

  const result = await runHelmCommand([
    "search",
    "repo",
    normalized,
    "--versions",
    "--output",
    "json",
    "--max-col-width",
    "0",
  ]);
  if (!result.success) {
    return { versions: [], error: result.error ?? "Failed to search chart versions" };
  }
  try {
    const parsed = JSON.parse(result.stdout || "[]") as Array<{
      name?: string;
      version?: string;
      app_version?: string;
    }>;
    const versions = parsed
      .filter(
        (entry): entry is Required<Pick<typeof entry, "name">> & typeof entry =>
          typeof entry.name === "string" && entry.name === normalized,
      )
      .map((entry) => ({
        name: entry.name,
        version: typeof entry.version === "string" ? entry.version : "",
        appVersion: typeof entry.app_version === "string" ? entry.app_version : undefined,
      }))
      .filter((entry) => entry.version.length > 0)
      .slice(0, limit);
    return { versions };
  } catch (error) {
    return {
      versions: [],
      error: error instanceof Error ? error.message : "Failed to parse chart versions",
    };
  }
}

export async function showHelmChartValues(
  chart: string,
  chartVersion?: string,
  options?: { repoName?: string; repoUrl?: string },
): Promise<{ values: string; error?: string }> {
  const normalized = chart.trim();
  if (!normalized) return { values: "", error: "Chart name is required" };

  // helm show values on `<repo>/<chart>` requires the repo to be present in
  // the local helm config. Add/refresh it first so the prefill-from-defaults
  // flow in the Catalog editor works even when the user has never installed
  // from that repo. OCI refs resolve directly and do not need repo add.
  const repoName = options?.repoName?.trim();
  const repoUrl = options?.repoUrl?.trim();
  const isOciRef = normalized.startsWith("oci://");
  if (!isOciRef && repoName && repoUrl) {
    await runHelmCommand(["repo", "add", repoName, repoUrl, "--force-update"]).catch(() => null);
    await runHelmCommand(["repo", "update", repoName]).catch(() => null);
  }

  const args = ["show", "values", normalized];
  if (chartVersion?.trim()) {
    args.push("--version", chartVersion.trim());
  }
  const result = await runHelmCommand(args);
  if (!result.success) {
    return { values: "", error: result.error ?? "Failed to fetch chart default values" };
  }
  return { values: result.stdout.trim() };
}

export async function addHelmRepo(name: string, url: string): Promise<HelmResult> {
  const repoName = name.trim();
  const repoUrl = url.trim();
  if (!repoName || !repoUrl) {
    return { success: false, error: "Repository name and URL are required" };
  }
  return ensureHelmRepo(repoName, repoUrl);
}

export async function removeHelmRepo(name: string): Promise<HelmResult> {
  const repoName = name.trim();
  if (!repoName) {
    return { success: false, error: "Repository name is required" };
  }

  const result = await runHelmCommand(["repo", "remove", repoName]);
  return result.success
    ? { success: true }
    : { success: false, error: formatHelmError(result, "Failed to remove Helm repository") };
}

export async function installOrUpgradeHelmRelease(
  clusterId: string,
  params: {
    releaseName: string;
    chart: string;
    namespace: string;
    createNamespace?: boolean;
    dryRun?: boolean;
    chartVersion?: string;
    /** Raw YAML content to pass via --values <tmpfile>. */
    valuesYaml?: string;
    /** When the chart is of the form `<repoName>/<chartName>`, ensure the repo
     *  is added/updated before the install. Pass explicit name + url to
     *  guarantee the repo exists and is fresh. */
    repoName?: string;
    repoUrl?: string;
    /**
     * Optional sink for a live transcript (banner + stdout/stderr chunks).
     * Panels pipe this into a ConsoleSession so the user watches the helm
     * run in real time instead of seeing only a final success/failure
     * banner.
     */
    onOutput?: (chunk: string) => void;
  },
): Promise<HelmResult & { output?: string }> {
  const releaseName = params.releaseName.trim();
  const chart = params.chart.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !chart || !namespace) {
    return { success: false, error: "Release name, chart and namespace are required" };
  }

  // Add/refresh repo so Helm can resolve `<repo>/<chart>`. Collect errors
  // here so that, if the subsequent upgrade --install also fails, we can
  // surface a compound message - otherwise users see only "chart not found"
  // and never learn the real cause was a repo add network failure.
  const repoName = params.repoName?.trim();
  const repoUrl = params.repoUrl?.trim();
  const repoErrors: string[] = [];
  if (repoName && repoUrl) {
    const addResult = await runHelmCommand(
      ["repo", "add", repoName, repoUrl, "--force-update"],
      undefined,
      params.onOutput,
    ).catch((e: unknown) => ({
      success: false,
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
      code: 1,
    }));
    if (!addResult.success) {
      repoErrors.push(
        `helm repo add ${repoName}: ${(addResult.stderr || addResult.stdout || "").trim()}`,
      );
    }
    const updateResult = await runHelmCommand(
      ["repo", "update", repoName],
      undefined,
      params.onOutput,
    ).catch((e: unknown) => ({
      success: false,
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
      code: 1,
    }));
    if (!updateResult.success) {
      repoErrors.push(
        `helm repo update ${repoName}: ${(updateResult.stderr || updateResult.stdout || "").trim()}`,
      );
    }
  }

  if (!params.dryRun) {
    await ensurePrivilegedNamespace(clusterId, namespace);
  }
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const args = ["upgrade", "--install", releaseName, chart, "--namespace", namespace];
  if (params.createNamespace ?? true) {
    args.push("--create-namespace");
  }
  if (!params.dryRun) {
    args.push("--wait=watcher", "--rollback-on-failure", "--timeout", "10m");
  }
  args.push("--kubeconfig", kubeconfigPath);
  if (params.chartVersion?.trim()) {
    args.push("--version", params.chartVersion.trim());
  }
  if (params.dryRun) {
    // Helm 3.13+ deprecated bare `--dry-run`; `client` renders without
    // talking to the cluster and is what modern preview UIs want.
    args.push("--dry-run=client");
  }

  let valuesCleanup: (() => Promise<void>) | null = null;
  if (params.valuesYaml?.trim()) {
    const { writeTextFile, remove } = await import("@tauri-apps/plugin-fs");
    const appDir = await appDataDir();
    const path = `${appDir}/helm-values-${Math.random().toString(36).slice(2, 10)}.yaml`;
    await writeTextFile(path, params.valuesYaml);
    args.push("--values", path);
    valuesCleanup = async () => {
      await remove(path).catch(() => {});
    };
  }

  try {
    const result = await runHelmCommand(args, undefined, params.onOutput);
    if (result.success) {
      return { success: true, output: result.stdout };
    }
    // Compose downstream install error + any earlier repo-add errors so the
    // real cause is never swallowed.
    const downstream = formatHelmError(result, "Helm install/upgrade failed");
    const compound = repoErrors.length > 0 ? `${repoErrors.join("\n")}\n${downstream}` : downstream;
    return { success: false, error: compound };
  } finally {
    if (valuesCleanup) await valuesCleanup();
  }
}

/**
 * Best-effort sweep of stale `helm-values-<rand>.yaml` tempfiles left by
 * crashed installs. Call on app startup.
 */
export async function sweepHelmValuesTempfiles(): Promise<void> {
  try {
    const { readDir, remove } = await import("@tauri-apps/plugin-fs");
    const appDir = await appDataDir();
    const entries = await readDir(appDir).catch(() => []);
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith("helm-values-") || !entry.name.endsWith(".yaml")) continue;
      // Best-effort delete; don't stat, just remove - the name random suffix
      // means a concurrent install won't collide.
      await remove(`${appDir}/${entry.name}`).catch(() => {});
    }
    void maxAgeMs;
    void now;
  } catch {
    // best-effort sweep; never fail app startup
  }
}

export async function uninstallHelmRelease(
  clusterId: string,
  params: {
    releaseName: string;
    namespace: string;
    onOutput?: (chunk: string) => void;
  },
): Promise<HelmResult> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !namespace) {
    return { success: false, error: "Release name and namespace are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand(
    [
      "uninstall",
      releaseName,
      "--namespace",
      namespace,
      "--timeout",
      "2m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    params.onOutput,
  );

  return result.success
    ? { success: true }
    : { success: false, error: formatHelmError(result, "Helm uninstall failed") };
}

export async function getHelmReleaseStatus(
  clusterId: string,
  params: { releaseName: string; namespace: string },
): Promise<{ status: Record<string, unknown> | null; error?: string }> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !namespace) {
    return { status: null, error: "Release name and namespace are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand([
    "status",
    releaseName,
    "--namespace",
    namespace,
    "--output",
    "json",
    "--kubeconfig",
    kubeconfigPath,
  ]);
  if (!result.success) {
    return { status: null, error: formatHelmError(result, "Failed to load release status") };
  }

  try {
    return { status: JSON.parse(result.stdout || "{}") as Record<string, unknown> };
  } catch (error) {
    return {
      status: null,
      error: error instanceof Error ? error.message : "Failed to parse release status",
    };
  }
}

export async function getHelmReleaseHistory(
  clusterId: string,
  params: { releaseName: string; namespace: string },
): Promise<{ history: HelmReleaseHistoryEntry[]; error?: string }> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !namespace) {
    return { history: [], error: "Release name and namespace are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand([
    "history",
    releaseName,
    "--namespace",
    namespace,
    "--output",
    "json",
    "--kubeconfig",
    kubeconfigPath,
  ]);
  if (!result.success) {
    return { history: [], error: formatHelmError(result, "Failed to load release history") };
  }

  try {
    return { history: JSON.parse(result.stdout || "[]") as HelmHistoryEntry[] };
  } catch (error) {
    return {
      history: [],
      error: error instanceof Error ? error.message : "Failed to parse release history",
    };
  }
}

export async function getHelmReleaseValues(
  clusterId: string,
  params: { releaseName: string; namespace: string; allValues?: boolean },
): Promise<{ values: string; error?: string }> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !namespace) {
    return { values: "", error: "Release name and namespace are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const args = [
    "get",
    "values",
    releaseName,
    "--namespace",
    namespace,
    "--kubeconfig",
    kubeconfigPath,
  ];
  if (params.allValues) args.splice(3, 0, "--all");

  const result = await runHelmCommand(args);
  return result.success
    ? { values: result.stdout || "" }
    : { values: "", error: formatHelmError(result, "Failed to load release values") };
}

export async function getHelmReleaseManifest(
  clusterId: string,
  params: { releaseName: string; namespace: string },
): Promise<{ manifest: string; error?: string }> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !namespace) {
    return { manifest: "", error: "Release name and namespace are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand([
    "get",
    "manifest",
    releaseName,
    "--namespace",
    namespace,
    "--kubeconfig",
    kubeconfigPath,
  ]);

  return result.success
    ? { manifest: result.stdout || "" }
    : { manifest: "", error: formatHelmError(result, "Failed to load release manifest") };
}

export async function rollbackHelmRelease(
  clusterId: string,
  params: {
    releaseName: string;
    namespace: string;
    revision: string;
    onOutput?: (chunk: string) => void;
  },
): Promise<HelmResult> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  const revision = params.revision.trim();
  if (!releaseName || !namespace || !revision) {
    return { success: false, error: "Release name, namespace and revision are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand(
    [
      "rollback",
      releaseName,
      revision,
      "--namespace",
      namespace,
      "--wait",
      "--timeout",
      "3m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    params.onOutput,
  );

  return result.success
    ? { success: true }
    : { success: false, error: formatHelmError(result, "Helm rollback failed") };
}

export async function testHelmRelease(
  clusterId: string,
  params: {
    releaseName: string;
    namespace: string;
    onOutput?: (chunk: string) => void;
  },
): Promise<{ success: boolean; logs: string; error?: string }> {
  const releaseName = params.releaseName.trim();
  const namespace = params.namespace.trim();
  if (!releaseName || !namespace) {
    return { success: false, logs: "", error: "Release name and namespace are required" };
  }

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand(
    [
      "test",
      releaseName,
      "--namespace",
      namespace,
      "--logs",
      "--timeout",
      "3m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    params.onOutput,
  );

  return result.success
    ? { success: true, logs: result.stdout || "" }
    : {
        success: false,
        logs: result.stdout || "",
        error: formatHelmError(result, "Helm test failed"),
      };
}

export async function getPlutoRelease(clusterId: string): Promise<HelmReleaseLookup> {
  const listed = await listHelmReleases(clusterId);
  if (listed.error) return { installed: false, error: listed.error };
  const match = listed.releases.find((release) => isPlutoRelease(release));
  if (!match) return { installed: false };
  return { installed: true, release: match };
}

export async function getVeleroRelease(clusterId: string): Promise<HelmReleaseLookup> {
  const listed = await listHelmReleases(clusterId);
  if (listed.error) return { installed: false, error: listed.error };
  const match = listed.releases.find((release) => isVeleroRelease(release));
  if (!match) return { installed: false };
  return { installed: true, release: match };
}

export async function getPrometheusStackRelease(clusterId: string): Promise<HelmReleaseLookup> {
  const listed = await listHelmReleases(clusterId);
  if (listed.error) return { installed: false, error: listed.error };
  const match = listed.releases.find((release) => isPrometheusStackRelease(release));
  if (!match) return { installed: false };
  return { installed: true, release: match };
}

export async function getKubescapeRelease(clusterId: string): Promise<HelmReleaseLookup> {
  const listed = await listHelmReleases(clusterId);
  if (listed.error) return { installed: false, error: listed.error };
  const match = listed.releases.find((release) => isKubescapeRelease(release));
  if (!match) return { installed: false };
  return { installed: true, release: match };
}

export async function getKubeBenchRelease(clusterId: string): Promise<HelmReleaseLookup> {
  const listed = await listHelmReleases(clusterId);
  if (listed.error) return { installed: false, error: listed.error };
  const match = listed.releases.find((release) => isKubeBenchRelease(release));
  if (!match) return { installed: false };
  return { installed: true, release: match };
}

export async function getTrivyOperatorRelease(clusterId: string): Promise<HelmReleaseLookup> {
  const listed = await listHelmReleases(clusterId);
  if (listed.error) return { installed: false, error: listed.error };
  const match = listed.releases.find((release) => isTrivyOperatorRelease(release));
  if (!match) return { installed: false };
  return { installed: true, release: match };
}

async function resolveReleaseLocation(
  clusterId: string,
): Promise<{ name: string; namespace: string } | null> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const result = await runHelmCommand([
    "list",
    "--all-namespaces",
    "--output",
    "json",
    "--kubeconfig",
    kubeconfigPath,
  ]);

  if (!result.success) return null;

  try {
    const releases = JSON.parse(result.stdout || "[]") as HelmRelease[];
    const match = releases.find((release) => release.chart.startsWith("kube-state-metrics"));
    return match ? { name: match.name, namespace: match.namespace } : null;
  } catch {
    return null;
  }
}

export async function installKubeStateMetrics(
  clusterId: string,
  namespace: string = DEFAULT_NAMESPACE,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const repoResult = await ensureHelmRepo(REPO_NAME, REPO_URL, onOutput);
  if (!repoResult.success) return repoResult;

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const installResult = await runHelmCommand(
    [
      "install",
      RELEASE_NAME,
      CHART_NAME,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  if (installResult.success) {
    return { success: true };
  }

  const message = installResult.error?.toLowerCase() ?? "";
  if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
    return { success: false, error: formatHelmError(installResult, "Helm install failed") };
  }

  return runHelm(
    [
      "upgrade",
      "--install",
      RELEASE_NAME,
      CHART_NAME,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );
}

export async function installMetricsServer(
  clusterId: string,
  namespace: string = METRICS_SERVER_NAMESPACE,
  profile: MetricsServerInstallProfile = "auto",
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const repoResult = await ensureHelmRepo(
    METRICS_SERVER_REPO_NAME,
    METRICS_SERVER_REPO_URL,
    onOutput,
  );
  if (!repoResult.success) return repoResult;

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const resolvedProfile = await resolveMetricsServerProfile(clusterId, profile);
  const installArgs = METRICS_SERVER_INSTALL_PROFILES[resolvedProfile].args;
  const installResult = await runHelmCommand(
    [
      "install",
      METRICS_SERVER_RELEASE,
      METRICS_SERVER_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--set-json",
      `args=${JSON.stringify(installArgs)}`,
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  if (installResult.success) {
    return { success: true };
  }

  const message = installResult.error?.toLowerCase() ?? "";
  if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
    return { success: false, error: formatHelmError(installResult, "Helm install failed") };
  }

  return runHelm(
    [
      "upgrade",
      "--install",
      METRICS_SERVER_RELEASE,
      METRICS_SERVER_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--set-json",
      `args=${JSON.stringify(installArgs)}`,
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );
}

export async function uninstallMetricsServer(
  clusterId: string,
  namespace: string = METRICS_SERVER_NAMESPACE,
  releaseName?: string,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const targetRelease = releaseName || METRICS_SERVER_RELEASE;
  const result = await runHelmCommand(
    [
      "uninstall",
      targetRelease,
      "--namespace",
      namespace,
      "--timeout",
      "2m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  return result.success
    ? { success: true }
    : { success: false, error: formatHelmError(result, "Helm uninstall failed") };
}

export async function installNodeExporter(
  clusterId: string,
  namespace: string = NODE_EXPORTER_NAMESPACE,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  await ensurePrivilegedNamespace(clusterId, namespace);
  const repoResult = await ensureHelmRepo(REPO_NAME, REPO_URL, onOutput);
  if (!repoResult.success) return repoResult;

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const installResult = await runHelmCommand(
    [
      "install",
      NODE_EXPORTER_RELEASE,
      NODE_EXPORTER_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  if (installResult.success) {
    return { success: true };
  }

  const message = installResult.error?.toLowerCase() ?? "";
  if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
    return { success: false, error: formatHelmError(installResult, "Helm install failed") };
  }

  return runHelm(
    [
      "upgrade",
      "--install",
      NODE_EXPORTER_RELEASE,
      NODE_EXPORTER_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );
}

export async function installKubescape(
  clusterId: string,
  namespace: string = KUBESCAPE_NAMESPACE,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  await ensurePrivilegedNamespace(clusterId, namespace);
  const repoResult = await ensureHelmRepo(KUBESCAPE_REPO_NAME, KUBESCAPE_REPO_URL, onOutput);
  if (!repoResult.success) return repoResult;

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const installResult = await runHelmCommand(
    [
      "install",
      KUBESCAPE_RELEASE,
      KUBESCAPE_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--set",
      "capabilities.continuousScan=enable",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  if (installResult.success) {
    return { success: true };
  }

  const message = installResult.error?.toLowerCase() ?? "";
  if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
    return { success: false, error: formatHelmError(installResult, "Helm install failed") };
  }

  return runHelm(
    [
      "upgrade",
      "--install",
      KUBESCAPE_RELEASE,
      KUBESCAPE_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--set",
      "capabilities.continuousScan=enable",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );
}

export function installKubeBench(
  clusterId: string,
  namespace: string = KUBE_BENCH_NAMESPACE,
): Promise<HelmResult> {
  void clusterId;
  void namespace;
  return Promise.resolve({
    success: false,
    error:
      "kube-bench does not currently provide an official Helm chart in aquasecurity repo. Use Job/DaemonSet execution instead.",
  });
}

export async function installTrivyOperator(
  clusterId: string,
  namespace: string = TRIVY_OPERATOR_NAMESPACE,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  await ensurePrivilegedNamespace(clusterId, namespace);
  const repoResult = await ensureHelmRepo(
    TRIVY_OPERATOR_REPO_NAME,
    TRIVY_OPERATOR_REPO_URL,
    onOutput,
  );
  if (!repoResult.success) return repoResult;
  return installByChartCandidates(
    clusterId,
    TRIVY_OPERATOR_RELEASE,
    namespace,
    TRIVY_OPERATOR_CHART_CANDIDATES,
    "10m",
    onOutput,
  );
}

export async function uninstallNodeExporter(
  clusterId: string,
  namespace: string = NODE_EXPORTER_NAMESPACE,
  releaseName?: string,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const targetRelease = releaseName || NODE_EXPORTER_RELEASE;
  const result = await runHelmCommand(
    [
      "uninstall",
      targetRelease,
      "--namespace",
      namespace,
      "--timeout",
      "2m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  return result.success
    ? { success: true }
    : { success: false, error: formatHelmError(result, "Helm uninstall failed") };
}

export async function uninstallKubeStateMetrics(
  clusterId: string,
  namespace: string = DEFAULT_NAMESPACE,
  releaseName?: string,
): Promise<HelmResult> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const targetRelease = releaseName || (await resolveReleaseName(clusterId, namespace));
  const primaryResult = await runHelmCommand([
    "uninstall",
    targetRelease ?? RELEASE_NAME,
    "--namespace",
    namespace,
    "--timeout",
    "2m",
    "--kubeconfig",
    kubeconfigPath,
  ]);

  if (primaryResult.success) {
    return { success: true };
  }

  const resolvedRelease = await resolveReleaseName(clusterId, namespace);
  if (!resolvedRelease || resolvedRelease === targetRelease) {
    const globalMatch = await resolveReleaseLocation(clusterId);
    if (!globalMatch) {
      return { success: false, error: formatHelmError(primaryResult, "Helm uninstall failed") };
    }

    if (globalMatch.name === targetRelease && globalMatch.namespace === namespace) {
      return { success: false, error: formatHelmError(primaryResult, "Helm uninstall failed") };
    }

    const globalResult = await runHelmCommand([
      "uninstall",
      globalMatch.name,
      "--namespace",
      globalMatch.namespace,
      "--timeout",
      "2m",
      "--kubeconfig",
      kubeconfigPath,
    ]);

    return globalResult.success
      ? { success: true }
      : { success: false, error: formatHelmError(globalResult, "Helm uninstall failed") };
  }

  const fallbackResult = await runHelmCommand([
    "uninstall",
    resolvedRelease,
    "--namespace",
    namespace,
    "--timeout",
    "2m",
    "--kubeconfig",
    kubeconfigPath,
  ]);

  return fallbackResult.success
    ? { success: true }
    : { success: false, error: formatHelmError(fallbackResult, "Helm uninstall failed") };
}

export async function installVelero(
  clusterId: string,
  namespace: string = VELERO_NAMESPACE,
  options?: {
    provider?: VeleroCloudProvider;
    bucket?: string;
    region?: string;
    s3Url?: string;
    forcePathStyle?: boolean;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsIamRoleArn?: string;
    azureResourceGroup?: string;
    azureStorageAccount?: string;
    azureSubscriptionId?: string;
    azureStorageAccountUri?: string;
    azureCloudName?: string;
    azureClientId?: string;
    azureClientSecret?: string;
    azureTenantId?: string;
    gcpProject?: string;
    gcpServiceAccount?: string;
    gcpCredentialsJson?: string;
  },
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const existing = await getVeleroRelease(clusterId);
  if (existing.error) return { success: false, error: existing.error };
  if (existing.installed) return { success: true };

  await ensurePrivilegedNamespace(clusterId, namespace);
  const repoResult = await ensureHelmRepo(VELERO_REPO_NAME, VELERO_REPO_URL, onOutput);
  if (!repoResult.success) return repoResult;

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const installArgs = [
    "install",
    VELERO_RELEASE,
    VELERO_CHART,
    "--namespace",
    namespace,
    "--create-namespace",
    "--wait=watcher",
    "--rollback-on-failure",
    "--timeout",
    "10m",
    "--kubeconfig",
    kubeconfigPath,
  ];

  const provider = options?.provider ?? "aws";
  const bucket = options?.bucket?.trim();
  const region = options?.region?.trim();
  const s3Url = options?.s3Url?.trim();
  const forcePathStyle = options?.forcePathStyle ?? true;

  const awsAccessKeyId = options?.awsAccessKeyId?.trim();
  const awsSecretAccessKey = options?.awsSecretAccessKey?.trim();
  const awsIamRoleArn = options?.awsIamRoleArn?.trim();
  const hasAwsStorageConfig = Boolean(bucket && region);
  const hasAwsSecretCredentials = Boolean(awsAccessKeyId && awsSecretAccessKey);
  const hasDoStorageConfig = Boolean(bucket && region && s3Url);

  const azureResourceGroup = options?.azureResourceGroup?.trim();
  const azureStorageAccount = options?.azureStorageAccount?.trim();
  const azureSubscriptionId = options?.azureSubscriptionId?.trim();
  const azureStorageAccountUri = options?.azureStorageAccountUri?.trim();
  const azureCloudName = options?.azureCloudName?.trim() || "AzurePublicCloud";
  const azureClientId = options?.azureClientId?.trim();
  const azureClientSecret = options?.azureClientSecret?.trim();
  const azureTenantId = options?.azureTenantId?.trim();
  const hasAzureStorageConfig = Boolean(bucket && azureResourceGroup && azureStorageAccount);
  const hasAzureSecretCredentials = Boolean(
    azureClientId &&
      azureClientSecret &&
      azureTenantId &&
      azureSubscriptionId &&
      azureResourceGroup,
  );

  const gcpProject = options?.gcpProject?.trim();
  const gcpServiceAccount = options?.gcpServiceAccount?.trim();
  const gcpCredentialsJson = options?.gcpCredentialsJson?.trim();
  const hasGcpStorageConfig = Boolean(bucket);
  const hasGcpSecretCredentials = Boolean(gcpCredentialsJson);

  if (provider === "do" && !hasDoStorageConfig) {
    return {
      success: false,
      error: "DigitalOcean Spaces install requires bucket, region, and endpoint URL.",
    };
  }
  if (provider === "do" && !hasAwsSecretCredentials) {
    return {
      success: false,
      error: "DigitalOcean Spaces install requires access key and secret key.",
    };
  }
  if (provider === "hetzner" && !hasDoStorageConfig) {
    return {
      success: false,
      error: "Hetzner Object Storage install requires bucket, region, and endpoint URL.",
    };
  }
  if (provider === "hetzner" && !hasAwsSecretCredentials) {
    return {
      success: false,
      error: "Hetzner Object Storage install requires access key and secret key.",
    };
  }
  if (provider === "azure" && hasAzureStorageConfig && !hasAzureSecretCredentials) {
    return {
      success: false,
      error:
        "Azure install currently requires client credentials (client id, client secret, tenant id, subscription id).",
    };
  }
  if (provider === "gcp" && hasGcpStorageConfig && !hasGcpSecretCredentials && !gcpServiceAccount) {
    return {
      success: false,
      error:
        "GCP install requires either service account JSON credentials or workload identity service account.",
    };
  }

  if (provider === "aws" || provider === "do" || provider === "hetzner") {
    if (hasAwsStorageConfig) {
      installArgs.push(
        "--set-string",
        "initContainers[0].name=velero-plugin-for-aws",
        "--set-string",
        "initContainers[0].image=velero/velero-plugin-for-aws:v1.13.1",
        "--set-string",
        "initContainers[0].volumeMounts[0].mountPath=/target",
        "--set-string",
        "initContainers[0].volumeMounts[0].name=plugins",
        "--set-string",
        "configuration.backupStorageLocation[0].name=default",
        "--set-string",
        "configuration.backupStorageLocation[0].provider=aws",
        "--set-string",
        `configuration.backupStorageLocation[0].bucket=${bucket}`,
        "--set-string",
        `configuration.backupStorageLocation[0].config.region=${region}`,
        "--set-string",
        `configuration.backupStorageLocation[0].config.s3ForcePathStyle=${String(forcePathStyle)}`,
        "--set",
        `credentials.useSecret=${hasAwsSecretCredentials}`,
      );

      if (provider === "aws") {
        installArgs.push(
          "--set-string",
          "configuration.volumeSnapshotLocation[0].name=default",
          "--set-string",
          "configuration.volumeSnapshotLocation[0].provider=aws",
          "--set-string",
          `configuration.volumeSnapshotLocation[0].config.region=${region}`,
        );
      } else {
        // DO/Hetzner use S3-compatible object store with AWS plugin; disable cloud volume snapshots.
        installArgs.push("--set-string", "snapshotsEnabled=false");
      }

      if (awsIamRoleArn) {
        installArgs.push(
          "--set-string",
          `serviceAccount.server.annotations.eks\\.amazonaws\\.com/role-arn=${awsIamRoleArn}`,
        );
      }
      if (hasAwsSecretCredentials) {
        const cloudIni = [
          "[default]",
          `aws_access_key_id=${awsAccessKeyId}`,
          `aws_secret_access_key=${awsSecretAccessKey}`,
        ].join("\n");
        installArgs.push(
          "--set",
          "credentials.useSecret=true",
          "--set-string",
          `credentials.secretContents.cloud=${cloudIni}`,
        );
      }
      if (s3Url) {
        installArgs.push(
          "--set-string",
          `configuration.backupStorageLocation[0].config.s3Url=${s3Url}`,
        );
      }
      if (provider === "do" || provider === "hetzner") {
        // S3-compatible providers don't support aws-chunked transfer encoding
        // introduced in aws-sdk-go-v2; disable CRC32 checksums.
        installArgs.push(
          "--set-string",
          `configuration.backupStorageLocation[0].config.checksumAlgorithm=`,
        );
      }
    }
  } else if (provider === "azure") {
    if (hasAzureStorageConfig) {
      installArgs.push(
        "--set-string",
        "initContainers[0].name=velero-plugin-for-microsoft-azure",
        "--set-string",
        "initContainers[0].image=velero/velero-plugin-for-microsoft-azure:v1.13.0",
        "--set-string",
        "initContainers[0].volumeMounts[0].mountPath=/target",
        "--set-string",
        "initContainers[0].volumeMounts[0].name=plugins",
        "--set-string",
        "configuration.backupStorageLocation[0].name=default",
        "--set-string",
        "configuration.backupStorageLocation[0].provider=azure",
        "--set-string",
        `configuration.backupStorageLocation[0].bucket=${bucket}`,
        "--set-string",
        "configuration.backupStorageLocation[0].config.useAAD=true",
        "--set-string",
        `configuration.backupStorageLocation[0].config.resourceGroup=${azureResourceGroup}`,
        "--set-string",
        `configuration.backupStorageLocation[0].config.storageAccount=${azureStorageAccount}`,
        "--set-string",
        "configuration.volumeSnapshotLocation[0].name=default",
        "--set-string",
        "configuration.volumeSnapshotLocation[0].provider=azure",
        "--set-string",
        `configuration.volumeSnapshotLocation[0].config.resourceGroup=${azureResourceGroup}`,
        "--set",
        `credentials.useSecret=${hasAzureSecretCredentials}`,
      );

      if (azureSubscriptionId) {
        installArgs.push(
          "--set-string",
          `configuration.backupStorageLocation[0].config.subscriptionId=${azureSubscriptionId}`,
          "--set-string",
          `configuration.volumeSnapshotLocation[0].config.subscriptionId=${azureSubscriptionId}`,
        );
      }
      if (azureStorageAccountUri) {
        installArgs.push(
          "--set-string",
          `configuration.backupStorageLocation[0].config.storageAccountURI=${azureStorageAccountUri}`,
        );
      }
      if (hasAzureSecretCredentials) {
        const azureCreds = [
          `AZURE_SUBSCRIPTION_ID=${azureSubscriptionId}`,
          `AZURE_RESOURCE_GROUP=${azureResourceGroup}`,
          `AZURE_CLOUD_NAME=${azureCloudName}`,
          `AZURE_CLIENT_ID=${azureClientId}`,
          `AZURE_CLIENT_SECRET=${azureClientSecret}`,
          `AZURE_TENANT_ID=${azureTenantId}`,
        ].join("\n");
        installArgs.push("--set-string", `credentials.secretContents.cloud=${azureCreds}`);
      }
    }
  } else {
    if (hasGcpStorageConfig) {
      installArgs.push(
        "--set-string",
        "initContainers[0].name=velero-plugin-for-gcp",
        "--set-string",
        "initContainers[0].image=velero/velero-plugin-for-gcp:v1.13.0",
        "--set-string",
        "initContainers[0].volumeMounts[0].mountPath=/target",
        "--set-string",
        "initContainers[0].volumeMounts[0].name=plugins",
        "--set-string",
        "configuration.backupStorageLocation[0].name=default",
        "--set-string",
        "configuration.backupStorageLocation[0].provider=gcp",
        "--set-string",
        `configuration.backupStorageLocation[0].bucket=${bucket}`,
        "--set-string",
        "configuration.volumeSnapshotLocation[0].name=default",
        "--set-string",
        "configuration.volumeSnapshotLocation[0].provider=gcp",
        "--set",
        `credentials.useSecret=${hasGcpSecretCredentials}`,
      );
      if (gcpProject) {
        installArgs.push(
          "--set-string",
          `configuration.volumeSnapshotLocation[0].config.project=${gcpProject}`,
        );
      }
      if (gcpServiceAccount) {
        installArgs.push(
          "--set-string",
          `configuration.backupStorageLocation[0].config.serviceAccount=${gcpServiceAccount}`,
          "--set-string",
          `serviceAccount.server.annotations.iam\\.gke\\.io/gcp-service-account=${gcpServiceAccount}`,
        );
      }
      if (hasGcpSecretCredentials) {
        installArgs.push("--set-string", `credentials.secretContents.cloud=${gcpCredentialsJson}`);
      }
    }
  }

  const installResult = await runHelmCommand(installArgs, undefined, onOutput);

  if (installResult.success) {
    return { success: true };
  }

  const message = installResult.error?.toLowerCase() ?? "";
  if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
    return { success: false, error: formatHelmError(installResult, "Helm install failed") };
  }

  const upgradeArgs = [
    "upgrade",
    "--install",
    VELERO_RELEASE,
    VELERO_CHART,
    "--namespace",
    namespace,
    "--create-namespace",
    "--wait=watcher",
    "--rollback-on-failure",
    "--timeout",
    "10m",
    "--kubeconfig",
    kubeconfigPath,
  ];
  const firstSetFlagIndex = installArgs.findIndex(
    (arg) => arg === "--set" || arg === "--set-string",
  );
  upgradeArgs.push(
    ...installArgs.slice(firstSetFlagIndex > -1 ? firstSetFlagIndex : installArgs.length),
  );

  return runHelm(upgradeArgs, undefined, onOutput);
}

export async function installPrometheusStack(
  clusterId: string,
  namespace: string = PROM_STACK_NAMESPACE,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const existing = await getPrometheusStackRelease(clusterId);
  if (existing.error) return { success: false, error: existing.error };
  if (existing.installed) return { success: true };

  await ensurePrivilegedNamespace(clusterId, namespace);
  const repoResult = await ensureHelmRepo(REPO_NAME, REPO_URL, onOutput);
  if (!repoResult.success) return repoResult;

  const kubeconfigPath = await getKubeconfigPath(clusterId);
  const installResult = await runHelmCommand(
    [
      "install",
      PROM_STACK_RELEASE,
      PROM_STACK_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );

  if (installResult.success) {
    return { success: true };
  }

  const message = installResult.error?.toLowerCase() ?? "";
  if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
    return { success: false, error: formatHelmError(installResult, "Helm install failed") };
  }

  return runHelm(
    [
      "upgrade",
      "--install",
      PROM_STACK_RELEASE,
      PROM_STACK_CHART,
      "--namespace",
      namespace,
      "--create-namespace",
      "--wait=watcher",
      "--rollback-on-failure",
      "--timeout",
      "10m",
      "--kubeconfig",
      kubeconfigPath,
    ],
    undefined,
    onOutput,
  );
}

async function installByChartCandidates(
  clusterId: string,
  release: string,
  namespace: string,
  chartCandidates: string[],
  timeout: string = "10m",
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  const kubeconfigPath = await getKubeconfigPath(clusterId);
  let lastError = "Helm install failed";

  for (const chart of chartCandidates) {
    const installResult = await runHelmCommand(
      [
        "install",
        release,
        chart,
        "--namespace",
        namespace,
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        timeout,
        "--kubeconfig",
        kubeconfigPath,
      ],
      undefined,
      onOutput,
    );

    if (installResult.success) return { success: true };

    const message = installResult.error?.toLowerCase() ?? "";
    const installError = formatHelmError(installResult, "Helm install failed");
    lastError = installError;

    if (!message.includes("cannot re-use a name") && !message.includes("already exists")) {
      const notFound =
        message.includes("chart") &&
        (message.includes("not found") || message.includes("failed to download"));
      if (notFound) {
        continue;
      }
      return { success: false, error: installError };
    }

    const upgrade = await runHelm(
      [
        "upgrade",
        "--install",
        release,
        chart,
        "--namespace",
        namespace,
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        timeout,
        "--kubeconfig",
        kubeconfigPath,
      ],
      undefined,
      onOutput,
    );
    if (upgrade.success) return { success: true };
    lastError = upgrade.error ?? lastError;
  }

  return { success: false, error: lastError };
}

export async function installKubeArmor(
  clusterId: string,
  namespace: string = KUBEARMOR_NAMESPACE,
  onOutput?: (chunk: string) => void,
): Promise<HelmResult> {
  await ensurePrivilegedNamespace(clusterId, namespace);
  const repoResult = await ensureHelmRepo(KUBEARMOR_REPO_NAME, KUBEARMOR_REPO_URL, onOutput);
  if (!repoResult.success) return repoResult;
  return installByChartCandidates(
    clusterId,
    KUBEARMOR_RELEASE,
    namespace,
    KUBEARMOR_CHART_CANDIDATES,
    "10m",
    onOutput,
  );
}

export function installModelArmor(
  clusterId: string,
  namespace: string = MODELARMOR_NAMESPACE,
): Promise<HelmResult> {
  void clusterId;
  void namespace;
  return Promise.resolve({
    success: false,
    error: `ModelArmor Helm chart (${MODELARMOR_CHART_CANDIDATES[0]}) for release ${MODELARMOR_RELEASE} is not currently published in the ${KUBEARMOR_REPO_NAME} charts index. Use manual install from ModelArmor docs/GitHub.`,
  });
}
