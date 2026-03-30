import { get, writable } from "svelte/store";
import {
  clusterRuntimeBudget,
  clusterRuntimeContext,
  isClusterRuntimeHeavyDiagnosticsActive,
} from "$shared/lib/cluster-runtime-manager";
import {
  activeDashboardRoute,
  isDashboardFeatureRouteActive,
} from "$shared/lib/dashboard-route-activity";
import { appDataDir } from "@tauri-apps/api/path";
import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import { fetchClusterVersion as fetchSharedClusterVersion } from "$shared/api/cluster-version";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { execCli } from "$shared/api/cli";
import { getPlutoRelease } from "$shared/api/helm";
import { clusterKey } from "$shared/lib/cluster-key";
import { CONFIG_DIR } from "$entities/config/model/appConfig";
import type {
  ClusterDeprecationScanState,
  DeprecationIssue,
  DeprecationIssueStatus,
  DeprecationScanConfig,
  DeprecationScanRun,
  DeprecationScanSummary,
  DeprecationSourceSummary,
  DeprecationStatus,
  DeprecationTrustLevel,
  ScanSourceStatus,
} from "./types";

const DEFAULT_CONFIG: DeprecationScanConfig = {
  targetVersion: "v1.31.0",
  cacheTtlMs: 12 * 60 * 60 * 1000,
  scheduleMs: 24 * 60 * 60 * 1000,
  enableFullScan: true,
  enableHelmScan: true,
  usePlutoForFullScan: true,
};

const MAX_HISTORY = 7;
const RECOMMENDED_MIN_TARGET = "v1.30.0";
const DEPRECATION_SCAN_STATE_STORAGE_KEY = "rozoom:deprecation-scan-state:v1";
const DEPRECATION_SCAN_TARGETS_STORAGE_KEY = "rozoom:deprecation-scan-targets:v1";
let plutoMissing: { detected: boolean; reason: string } = {
  detected: false,
  reason: "Pluto command is unavailable",
};

const DEFAULT_SUMMARY: DeprecationScanSummary = {
  status: "unavailable",
  deprecatedCount: 0,
  helmDeprecatedCount: 0,
  criticalCount: 0,
  lastRunAt: null,
  targetVersion: DEFAULT_CONFIG.targetVersion,
  clusterVersion: null,
  cacheExpiresAt: null,
  message: "Scan unavailable",
  warnings: [],
  trustLevel: "limited",
  sourceSummaries: [],
};

export const deprecationScanConfig = writable<DeprecationScanConfig>(DEFAULT_CONFIG);
function readPersistedDeprecationScanState(): Record<
  string,
  ClusterDeprecationScanState | undefined
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEPRECATION_SCAN_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ClusterDeprecationScanState | undefined>;
  } catch {
    return {};
  }
}

function readPersistedDeprecationTargets(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEPRECATION_SCAN_TARGETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export const deprecationScanState = writable<
  Record<string, ClusterDeprecationScanState | undefined>
>(readPersistedDeprecationScanState());
export const deprecationScanTargetVersionByCluster = writable<Record<string, string>>(
  readPersistedDeprecationTargets(),
);

if (typeof window !== "undefined") {
  deprecationScanState.subscribe((state) => {
    try {
      window.localStorage.setItem(DEPRECATION_SCAN_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage write errors
    }
  });
  deprecationScanTargetVersionByCluster.subscribe((state) => {
    try {
      window.localStorage.setItem(DEPRECATION_SCAN_TARGETS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage write errors
    }
  });
}

type PollController = {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
};

const scanControllers = new Map<string, PollController>();
const inFlightScans = new Map<string, Promise<DeprecationScanSummary>>();

type DeprecatedApiMetric = {
  group: string;
  version: string;
  resource: string;
  removedRelease?: string;
  value: number;
};

type ScanSourceResult = {
  findings: DeprecationIssue[];
  summary: DeprecationSourceSummary;
  warnings: string[];
  errors: string[];
};

const RESOURCE_KIND_MAP: Record<string, string> = {
  componentstatuses: "ComponentStatus",
  cronjobs: "CronJob",
  daemonsets: "DaemonSet",
  deployments: "Deployment",
  endpoints: "Endpoints",
  events: "Event",
  horizontalpodautoscalers: "HorizontalPodAutoscaler",
  ingresses: "Ingress",
  jobs: "Job",
  mutatingwebhookconfigurations: "MutatingWebhookConfiguration",
  namespaces: "Namespace",
  networkpolicies: "NetworkPolicy",
  nodes: "Node",
  persistentvolumeclaims: "PersistentVolumeClaim",
  persistentvolumes: "PersistentVolume",
  poddisruptionbudgets: "PodDisruptionBudget",
  pods: "Pod",
  replicasets: "ReplicaSet",
  replicationcontrollers: "ReplicationController",
  resourcequotas: "ResourceQuota",
  secrets: "Secret",
  serviceaccounts: "ServiceAccount",
  services: "Service",
  statefulsets: "StatefulSet",
  validatingwebhookconfigurations: "ValidatingWebhookConfiguration",
};

function parseSemver(version: string): [number, number, number] {
  const normalized = version.replace(/^v/, "").trim();
  const [major, minor, patch = "0"] = normalized.split(".");
  const cleanMinor = (minor || "0").replace(/\D.*$/, "");
  const cleanPatch = patch.replace(/\D.*$/, "");
  return [
    Number.parseInt(major || "0", 10) || 0,
    Number.parseInt(cleanMinor || "0", 10) || 0,
    Number.parseInt(cleanPatch || "0", 10) || 0,
  ];
}

function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

function isVersionLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^v?\d+\.\d+(\.\d+)?/.test(value.trim());
}

function normalizeVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function parseLabels(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_]+)="([^"]*)"/g;
  let match = regex.exec(raw);
  while (match) {
    result[match[1]] = match[2];
    match = regex.exec(raw);
  }
  return result;
}

export function parseDeprecatedApiMetrics(raw: string): DeprecatedApiMetric[] {
  const lines = raw.split("\n");
  const metrics: DeprecatedApiMetric[] = [];

  for (const line of lines) {
    if (!line.startsWith("apiserver_requested_deprecated_apis{")) continue;
    const match = line.match(/^apiserver_requested_deprecated_apis\{([^}]*)\}\s+([0-9.eE+-]+)$/);
    if (!match) continue;

    const labels = parseLabels(match[1]);
    const value = Number.parseFloat(match[2]);
    if (!Number.isFinite(value) || value <= 0) continue;

    metrics.push({
      group: labels.group || "",
      version: labels.version || "",
      resource: labels.resource || "unknown",
      removedRelease: labels.removed_release,
      value,
    });
  }

  return metrics;
}

export function resourceToKind(resource: string): string {
  const normalizedResource = (resource || "").split("/")[0].split(".")[0].trim().toLowerCase();

  if (!normalizedResource) return "Resource";
  if (RESOURCE_KIND_MAP[normalizedResource]) return RESOURCE_KIND_MAP[normalizedResource];

  let base = normalizedResource;
  if (base.endsWith("statuses")) {
    base = base.slice(0, -3);
  } else if (base.endsWith("ies")) {
    base = `${base.slice(0, -3)}y`;
  } else if (base.endsWith("sses")) {
    base = base.slice(0, -2);
  } else if (base.endsWith("s") && base.length > 1) {
    base = base.slice(0, -1);
  }

  return base
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function buildObservedIssuesFromMetrics(
  clusterId: string,
  targetVersion: string,
  metrics: DeprecatedApiMetric[],
): DeprecationIssue[] {
  return metrics.map((metric) => {
    const apiVersion = metric.group ? `${metric.group}/${metric.version}` : metric.version;
    const removedVersion = metric.removedRelease ? `v${metric.removedRelease}.0` : null;
    const isRemoved = removedVersion !== null && compareSemver(targetVersion, removedVersion) >= 0;
    return {
      id: `${clusterId}-observed-${metric.group}-${metric.version}-${metric.resource}`,
      kind: resourceToKind(metric.resource),
      namespace: "",
      name: metric.resource,
      apiVersion,
      replacementVersion: removedVersion
        ? `Removed in ${removedVersion}`
        : "No direct replacement from metric source",
      status: isRemoved ? "removed" : "deprecated",
      source: "cluster",
      scope: "observed",
      requestCount: metric.value,
      resource: metric.resource,
    } as DeprecationIssue;
  });
}

function getIssueStatusFromRemovedVersion(
  targetVersion: string,
  removedVersion: string | null,
): DeprecationIssueStatus {
  if (!removedVersion) return "deprecated";
  return compareSemver(targetVersion, removedVersion) >= 0 ? "removed" : "deprecated";
}

function getReplacementVersion(item: Record<string, unknown>): string {
  const removedIn =
    (item.removed as string | undefined) ||
    (item.removedIn as string | undefined) ||
    (item.removed_in as string | undefined) ||
    (item["removed-in"] as string | undefined) ||
    null;

  const replacement =
    (item.replacement as string | undefined) ||
    (item.replacementVersion as string | undefined) ||
    (item.replacement_api as string | undefined) ||
    (item.replacementApi as string | undefined) ||
    (item["replacement-api"] as string | undefined) ||
    null;

  if (replacement && replacement.trim().length > 0) return replacement;
  if (removedIn && removedIn.trim().length > 0) return `Removed in ${normalizeVersion(removedIn)}`;

  return "No direct replacement reported";
}

function parsePlutoLikeResults(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item) => typeof item === "object" && item !== null) as Array<
      Record<string, unknown>
    >;
  }

  if (typeof payload === "object" && payload !== null) {
    const objectPayload = payload as Record<string, unknown>;
    const candidateKeys = ["items", "results", "deprecated", "resources"];
    for (const key of candidateKeys) {
      const candidate = objectPayload[key];
      if (Array.isArray(candidate)) {
        return candidate.filter((item) => typeof item === "object" && item !== null) as Array<
          Record<string, unknown>
        >;
      }
    }
  }

  return [];
}

function mapPlutoIssue(
  clusterId: string,
  targetVersion: string,
  item: Record<string, unknown>,
  scope: "fullScan" | "helmTemplate",
): DeprecationIssue | null {
  const kindRaw =
    (item.kind as string | undefined) ||
    (item.Kind as string | undefined) ||
    (item.objectKind as string | undefined) ||
    "Resource";

  const name =
    (item.name as string | undefined) ||
    (item.objectName as string | undefined) ||
    (item.resourceName as string | undefined) ||
    "unknown";

  const namespace =
    (item.namespace as string | undefined) ||
    (item.objectNamespace as string | undefined) ||
    (item.ns as string | undefined) ||
    "";

  const apiVersion =
    (item.apiVersion as string | undefined) ||
    (item.version as string | undefined) ||
    (item.api_version as string | undefined) ||
    "unknown";

  if (!apiVersion || apiVersion === "unknown") return null;

  const removedRaw =
    (item.removed as string | undefined) ||
    (item.removedIn as string | undefined) ||
    (item.removed_in as string | undefined) ||
    (item["removed-in"] as string | undefined) ||
    null;

  const removedVersion = removedRaw ? normalizeVersion(removedRaw) : null;

  return {
    id: `${clusterId}-${scope}-${namespace}-${name}-${apiVersion}`,
    kind: kindRaw,
    namespace,
    name,
    apiVersion,
    replacementVersion: getReplacementVersion(item),
    status: getIssueStatusFromRemovedVersion(targetVersion, removedVersion),
    source: scope === "helmTemplate" ? "helm" : "cluster",
    scope,
  };
}

async function resolveKubeconfigPath(clusterId: string): Promise<string> {
  const appLocalDataDirPath = await appDataDir();
  const safeId = clusterKey(clusterId);
  return `${appLocalDataDirPath}/${CONFIG_DIR}/${safeId}.yaml`;
}

async function fetchClusterVersion(clusterId: string): Promise<string | null> {
  const response = await fetchSharedClusterVersion(clusterId);
  const gitVersion = response.version?.gitVersion;
  if (!gitVersion || !isVersionLike(gitVersion)) return null;
  return normalizeVersion(gitVersion.replace(/^v/, "").split("+")[0]);
}

function deduplicateIssues(issues: DeprecationIssue[]): DeprecationIssue[] {
  const byKey = new Map<string, DeprecationIssue>();

  const priority = (issue: DeprecationIssue): number => {
    if (issue.scope === "helmTemplate") return 3;
    if (issue.scope === "fullScan") return 2;
    return 1;
  };

  for (const issue of issues) {
    const key = [issue.source, issue.kind, issue.namespace, issue.name, issue.apiVersion].join("|");
    const existing = byKey.get(key);
    if (!existing || priority(issue) > priority(existing)) {
      byKey.set(key, issue);
      continue;
    }

    if ((issue.requestCount || 0) > (existing.requestCount || 0)) {
      byKey.set(key, issue);
    }
  }

  return [...byKey.values()];
}

function sortIssues(issues: DeprecationIssue[]): DeprecationIssue[] {
  return [...issues].sort((a, b) => {
    if (a.status !== b.status) return a.status === "removed" ? -1 : 1;
    const aCount = a.requestCount ?? 0;
    const bCount = b.requestCount ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    if (a.scope !== b.scope) {
      const rank = (scope: DeprecationIssue["scope"]) =>
        scope === "fullScan" ? 3 : scope === "helmTemplate" ? 2 : 1;
      return rank(b.scope) - rank(a.scope);
    }
    return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
  });
}

function buildStatus(criticalCount: number, deprecatedCount: number): DeprecationStatus {
  if (criticalCount > 0) return "critical";
  if (deprecatedCount > 0) return "warning";
  return "ok";
}

function deriveTrustLevel(sourceSummaries: DeprecationSourceSummary[]): DeprecationTrustLevel {
  const full = sourceSummaries.find((source) => source.id === "fullScan");
  const helm = sourceSummaries.find((source) => source.id === "helmTemplate");
  const observed = sourceSummaries.find((source) => source.id === "observed");

  const fullOk = full?.status === "ok";
  const helmOk = helm?.status === "ok";
  const observedOk = observed?.status === "ok";

  if (fullOk && helmOk) return "full";
  if (fullOk || helmOk) return "mixed";
  if (observedOk) return "observed";
  return "limited";
}

function buildSummary(
  run: DeprecationScanRun,
  cacheTtlMs: number,
  clusterVersion: string | null,
  warnings: string[],
): DeprecationScanSummary {
  const cacheExpiresAt = new Date(new Date(run.runAt).getTime() + cacheTtlMs).toISOString();
  const totalDeprecated = run.deprecatedCount + run.helmDeprecatedCount;

  const statusText =
    run.status === "ok"
      ? "No deprecated APIs found"
      : `${totalDeprecated} deprecated API${totalDeprecated === 1 ? "" : "s"} found`;

  return {
    status: run.status,
    deprecatedCount: run.deprecatedCount,
    helmDeprecatedCount: run.helmDeprecatedCount,
    criticalCount: run.criticalCount,
    lastRunAt: run.runAt,
    targetVersion: run.targetVersion,
    clusterVersion,
    cacheExpiresAt,
    message: statusText,
    errors: run.errors,
    warnings,
    trustLevel: run.trustLevel,
    sourceSummaries: run.sourceSummaries,
  };
}

function normalizeScanSourceSummary(
  id: DeprecationSourceSummary["id"],
  label: string,
  findings: number,
  status: ScanSourceStatus,
  message: string,
): DeprecationSourceSummary {
  return { id, label, findings, status, message };
}

function isPlutoMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("scoped command pluto not found") ||
    normalized.includes("command not found")
  );
}

function buildPlutoArgs(targetVersion: string, scope: "fullScan" | "helmTemplate"): string[] {
  const targetArg = `k8s=${targetVersion}`;
  return scope === "helmTemplate"
    ? ["detect-helm", "--target-versions", targetArg, "-o", "json"]
    : ["detect-api-resources", "--target-versions", targetArg, "-o", "json"];
}

async function resolvePlutoPodName(
  clusterId: string,
  namespace: string,
  releaseName: string,
): Promise<string | null> {
  const parsePodName = (output: string): string | null => {
    try {
      const parsed = JSON.parse(output) as {
        items?: Array<{ metadata?: { name?: string }; status?: { phase?: string } }>;
      };
      const items = parsed.items ?? [];
      const running = items.find((item) => item.status?.phase === "Running");
      return running?.metadata?.name ?? items[0]?.metadata?.name ?? null;
    } catch {
      return null;
    }
  };

  const byRelease = await kubectlRawArgsFront(
    [
      "get",
      "pods",
      "-n",
      namespace,
      "-l",
      `app.kubernetes.io/instance=${releaseName}`,
      "-o",
      "json",
    ],
    { clusterId },
  );

  if (byRelease.code === 0 && byRelease.output) {
    const pod = parsePodName(byRelease.output);
    if (pod) return pod;
  }

  const byName = await kubectlRawArgsFront(
    ["get", "pods", "-n", namespace, "-l", "app.kubernetes.io/name=pluto", "-o", "json"],
    { clusterId },
  );

  if (byName.code === 0 && byName.output) {
    return parsePodName(byName.output);
  }

  return null;
}

async function runPlutoScanInCluster(
  clusterId: string,
  targetVersion: string,
  scope: "fullScan" | "helmTemplate",
): Promise<ScanSourceResult> {
  const sourceId = scope === "helmTemplate" ? "helmTemplate" : "fullScan";
  const sourceLabel =
    scope === "helmTemplate" ? "Helm templates (Pluto)" : "Full cluster scan (Pluto)";

  const release = await getPlutoRelease(clusterId);
  if (release.error) {
    return {
      findings: [],
      summary: normalizeScanSourceSummary(sourceId, sourceLabel, 0, "unavailable", release.error),
      warnings: [],
      errors: [release.error],
    };
  }

  if (!release.installed || !release.release) {
    return {
      findings: [],
      summary: normalizeScanSourceSummary(
        sourceId,
        sourceLabel,
        0,
        "unavailable",
        "Pluto Helm release is not installed",
      ),
      warnings: [],
      errors: ["Pluto Helm release is not installed"],
    };
  }

  const podName = await resolvePlutoPodName(
    clusterId,
    release.release.namespace,
    release.release.name,
  );
  if (!podName) {
    return {
      findings: [],
      summary: normalizeScanSourceSummary(
        sourceId,
        sourceLabel,
        0,
        "unavailable",
        "Pluto pod was not found in release namespace",
      ),
      warnings: [],
      errors: ["Pluto pod was not found in release namespace"],
    };
  }

  const plutoArgs = buildPlutoArgs(targetVersion, scope);
  const execResult = await kubectlRawArgsFront(
    ["exec", "-n", release.release.namespace, podName, "--", "pluto", ...plutoArgs],
    { clusterId },
  );

  if (execResult.errors || execResult.code !== 0) {
    const message = execResult.errors || "Failed to run Pluto scan in cluster";
    return {
      findings: [],
      summary: normalizeScanSourceSummary(sourceId, sourceLabel, 0, "unavailable", message),
      warnings: [],
      errors: [message],
    };
  }

  const parsed = parsePlutoOutput(clusterId, targetVersion, execResult.output, scope);
  if (parsed.parseError) {
    return {
      findings: [],
      summary: normalizeScanSourceSummary(
        sourceId,
        sourceLabel,
        0,
        "warning",
        "Pluto output format changed or contained no parseable findings.",
      ),
      warnings: ["Pluto output format changed or contained no parseable findings."],
      errors: [],
    };
  }

  return {
    findings: parsed.issues,
    summary: normalizeScanSourceSummary(
      sourceId,
      sourceLabel,
      parsed.issues.length,
      "ok",
      `Live scan via Helm release ${release.release.name}/${release.release.namespace}`,
    ),
    warnings: [],
    errors: [],
  };
}

async function runObservedMetricsScan(
  clusterId: string,
  targetVersion: string,
): Promise<ScanSourceResult> {
  const response = await fetchApiserverMetrics(clusterId);
  if (response.error) {
    return {
      findings: [],
      summary: normalizeScanSourceSummary(
        "observed",
        "Observed API requests",
        0,
        "unavailable",
        "Unable to load apiserver metrics",
      ),
      warnings: [],
      errors: [response.error || "Failed to fetch apiserver metrics for deprecation scan."],
    };
  }

  const metrics = parseDeprecatedApiMetrics(response.output);
  const findings = buildObservedIssuesFromMetrics(clusterId, targetVersion, metrics);

  return {
    findings,
    summary: normalizeScanSourceSummary(
      "observed",
      "Observed API requests",
      findings.length,
      "ok",
      "Live metric source: apiserver_requested_deprecated_apis",
    ),
    warnings: [
      "Observed source only includes APIs requested since apiserver restart.",
      "Object identity from observed metrics can be approximate.",
    ],
    errors: [],
  };
}

function parsePlutoOutput(
  clusterId: string,
  targetVersion: string,
  stdout: string,
  scope: "fullScan" | "helmTemplate",
): { issues: DeprecationIssue[]; parseError: boolean } {
  try {
    const payload = JSON.parse(stdout) as unknown;
    const items = parsePlutoLikeResults(payload);
    const issues = items
      .map((item) => mapPlutoIssue(clusterId, targetVersion, item, scope))
      .filter((issue): issue is DeprecationIssue => issue !== null);
    return { issues, parseError: false };
  } catch {
    return { issues: [], parseError: true };
  }
}

async function runPlutoScan(
  clusterId: string,
  targetVersion: string,
  scope: "fullScan" | "helmTemplate",
): Promise<ScanSourceResult> {
  const kubeconfigPath = await resolveKubeconfigPath(clusterId);
  const args = [...buildPlutoArgs(targetVersion, scope), "--kubeconfig", kubeconfigPath];

  const sourceId = scope === "helmTemplate" ? "helmTemplate" : "fullScan";
  const sourceLabel =
    scope === "helmTemplate" ? "Helm templates (Pluto)" : "Full cluster scan (Pluto)";
  let result: { code: number; stdout: string; stderr: string };

  if (plutoMissing.detected) {
    return runPlutoScanInCluster(clusterId, targetVersion, scope);
  }

  try {
    result = await execCli("pluto", args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pluto command is unavailable";
    if (isPlutoMissingError(message)) {
      plutoMissing = { detected: true, reason: message };
      return runPlutoScanInCluster(clusterId, targetVersion, scope);
    }
    return {
      findings: [],
      summary: normalizeScanSourceSummary(sourceId, sourceLabel, 0, "unavailable", message),
      warnings: [],
      errors: [message],
    };
  }

  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    const unavailableMessage =
      stderr.length > 0
        ? stderr
        : `Pluto ${scope === "helmTemplate" ? "helm" : "cluster"} scan failed`;
    if (isPlutoMissingError(unavailableMessage)) {
      plutoMissing = { detected: true, reason: unavailableMessage };
      return runPlutoScanInCluster(clusterId, targetVersion, scope);
    }
    return {
      findings: [],
      summary: normalizeScanSourceSummary(
        sourceId,
        sourceLabel,
        0,
        "unavailable",
        unavailableMessage,
      ),
      warnings: [],
      errors: [unavailableMessage],
    };
  }

  const parsed = parsePlutoOutput(clusterId, targetVersion, result.stdout, scope);
  const findings = parsed.issues;
  if (parsed.parseError) {
    return {
      findings: [],
      summary: normalizeScanSourceSummary(
        sourceId,
        sourceLabel,
        0,
        "warning",
        "Pluto output parsed with no findings",
      ),
      warnings: ["Pluto output format changed or contained no parseable findings."],
      errors: [],
    };
  }

  return {
    findings,
    summary: normalizeScanSourceSummary(
      sourceId,
      sourceLabel,
      findings.length,
      "ok",
      "Live scan completed",
    ),
    warnings: [],
    errors: [],
  };
}

function issueListStatus(issues: DeprecationIssue[]): DeprecationStatus {
  const critical = issues.some((issue) => issue.status === "removed");
  if (critical) return "critical";
  if (issues.length > 0) return "warning";
  return "ok";
}

function buildTargetWarnings(targetVersion: string, clusterVersion: string | null): string[] {
  const warnings: string[] = [];

  if (compareSemver(targetVersion, RECOMMENDED_MIN_TARGET) < 0) {
    warnings.push(
      `Target Kubernetes version ${targetVersion} is older than recommended baseline ${RECOMMENDED_MIN_TARGET}.`,
    );
  }

  if (!clusterVersion) {
    warnings.push("Could not detect cluster server version; target-version comparison is limited.");
    return warnings;
  }

  if (compareSemver(targetVersion, clusterVersion) < 0) {
    warnings.push(
      `Target version ${targetVersion} is lower than cluster server version ${clusterVersion}; findings may be understated.`,
    );
  }

  return warnings;
}

function getClusterTargetVersion(clusterId: string, config: DeprecationScanConfig): string | null {
  const map = get(deprecationScanTargetVersionByCluster);
  return map[clusterId] || config.targetVersion;
}

async function buildRun(
  clusterId: string,
  config: DeprecationScanConfig,
  source: "auto" | "manual",
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceSummaries: DeprecationSourceSummary[] = [];

  const clusterVersion = await fetchClusterVersion(clusterId);
  const configuredTarget = getClusterTargetVersion(clusterId, config);
  const targetVersion = configuredTarget || clusterVersion;
  if (!targetVersion || !isVersionLike(targetVersion)) {
    return {
      run: null,
      warnings: ["Target Kubernetes version is not configured or invalid."],
      clusterVersion: null,
      errors: [],
    };
  }

  const normalizedTarget = normalizeVersion(targetVersion);
  warnings.push(...buildTargetWarnings(normalizedTarget, clusterVersion));

  const observed = await runObservedMetricsScan(clusterId, normalizedTarget);
  sourceSummaries.push(observed.summary);
  warnings.push(...observed.warnings);
  errors.push(...observed.errors);

  let fullScanIssues: DeprecationIssue[] = [];
  let helmIssues: DeprecationIssue[] = [];

  if (config.enableFullScan && config.usePlutoForFullScan) {
    const fullScan = await runPlutoScan(clusterId, normalizedTarget, "fullScan");
    fullScanIssues = fullScan.findings;
    sourceSummaries.push(fullScan.summary);
    warnings.push(...fullScan.warnings);
    errors.push(...fullScan.errors);
  } else {
    sourceSummaries.push(
      normalizeScanSourceSummary(
        "fullScan",
        "Full cluster scan (Pluto)",
        0,
        "unavailable",
        "Disabled in settings",
      ),
    );
  }

  if (config.enableHelmScan) {
    const helm = await runPlutoScan(clusterId, normalizedTarget, "helmTemplate");
    helmIssues = helm.findings;
    sourceSummaries.push(helm.summary);
    warnings.push(...helm.warnings);
    errors.push(...helm.errors);
  } else {
    sourceSummaries.push(
      normalizeScanSourceSummary(
        "helmTemplate",
        "Helm templates (Pluto)",
        0,
        "unavailable",
        "Disabled in settings",
      ),
    );
  }

  const mergedClusterIssues = deduplicateIssues([...observed.findings, ...fullScanIssues]);
  const issues = sortIssues(mergedClusterIssues);
  const sortedHelmIssues = sortIssues(helmIssues);

  const deprecatedCount = issues.length;
  const helmDeprecatedCount = sortedHelmIssues.length;
  const criticalCount = [...issues, ...sortedHelmIssues].filter(
    (issue) => issue.status === "removed",
  ).length;

  const combinedStatus =
    errors.length > 0 && deprecatedCount + helmDeprecatedCount === 0
      ? "unavailable"
      : buildStatus(criticalCount, deprecatedCount + helmDeprecatedCount);

  const trustLevel = deriveTrustLevel(sourceSummaries);
  if (trustLevel === "observed") {
    warnings.push(
      "Only observed API request source is available. Run full scan for object-level coverage.",
    );
  }
  if (trustLevel === "limited") {
    warnings.push("No reliable scan source available; results may be incomplete.");
  }

  const runAt = new Date().toISOString();
  const notes = [
    "Observed source uses apiserver_requested_deprecated_apis metric.",
    "Pluto full scan and helm scan are preferred for upgrade readiness.",
  ];

  return {
    run: {
      id: `${clusterId}-${runAt}`,
      runAt,
      targetVersion: normalizedTarget,
      source,
      issues,
      helmIssues: sortedHelmIssues,
      deprecatedCount,
      helmDeprecatedCount,
      criticalCount,
      status: combinedStatus,
      notes,
      errors: errors.length ? [...new Set(errors)] : undefined,
      trustLevel,
      sourceSummaries,
    } as DeprecationScanRun,
    warnings: [...new Set(warnings)],
    clusterVersion,
    errors,
  };
}

function ensureState(
  clusterId: string,
  config: DeprecationScanConfig,
  fallbackStatus: DeprecationStatus,
  message: string,
): ClusterDeprecationScanState {
  const summary: DeprecationScanSummary = {
    ...DEFAULT_SUMMARY,
    status: fallbackStatus,
    targetVersion: getClusterTargetVersion(clusterId, config),
    message,
    warnings: [],
    trustLevel: "limited",
    sourceSummaries: [
      {
        id: "observed",
        label: "Observed API requests",
        status: "unavailable",
        findings: 0,
        message,
      },
    ],
  };

  return {
    summary,
    history: [],
  };
}

export async function runDeprecationScan(
  clusterId: string,
  options?: { force?: boolean; source?: "auto" | "manual" },
): Promise<DeprecationScanSummary> {
  const inFlight = inFlightScans.get(clusterId);
  if (inFlight) {
    return inFlight;
  }

  const runPromise = (async () => {
    const config = get(deprecationScanConfig);
    const currentState = get(deprecationScanState)[clusterId];

    const targetVersion = getClusterTargetVersion(clusterId, config);
    if (!targetVersion || !isVersionLike(targetVersion)) {
      const nextState = ensureState(
        clusterId,
        config,
        "needsConfig",
        "Set valid target Kubernetes version (for example, v1.31.0)",
      );

      deprecationScanState.update((state) => ({
        ...state,
        [clusterId]: nextState,
      }));

      return nextState.summary;
    }

    if (currentState?.summary.lastRunAt && !options?.force) {
      const cachedUntil = currentState.summary.cacheExpiresAt
        ? new Date(currentState.summary.cacheExpiresAt).getTime()
        : 0;
      if (Date.now() < cachedUntil) {
        return currentState.summary;
      }
    }

    const { run, warnings, clusterVersion } = await buildRun(
      clusterId,
      config,
      options?.source ?? "auto",
    );

    if (!run) {
      const nextState = ensureState(clusterId, config, "needsConfig", "Need configuration");
      deprecationScanState.update((state) => ({
        ...state,
        [clusterId]: {
          ...nextState,
          summary: {
            ...nextState.summary,
            warnings,
          },
        },
      }));
      return nextState.summary;
    }

    const summary = buildSummary(run, config.cacheTtlMs, clusterVersion, warnings);
    const nextHistory = [run, ...(currentState?.history ?? [])].slice(0, MAX_HISTORY);

    deprecationScanState.update((state) => ({
      ...state,
      [clusterId]: {
        summary,
        history: nextHistory,
      },
    }));

    return summary;
  })().finally(() => {
    if (inFlightScans.get(clusterId) === runPromise) {
      inFlightScans.delete(clusterId);
    }
  });

  inFlightScans.set(clusterId, runPromise);
  return runPromise;
}

export function startDeprecationScanPolling(clusterId: string) {
  if (!clusterId) return;

  const existing = scanControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureDeprecationScanPolling(clusterId, existing);
    return;
  }

  const controller: PollController = { refCount: 1, timer: null };
  scanControllers.set(clusterId, controller);
  ensureDeprecationScanPolling(clusterId, controller);
}

export function stopDeprecationScanPolling(clusterId: string) {
  const controller = scanControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopDeprecationScanTimer(controller);
  scanControllers.delete(clusterId);
}

export function stopAllDeprecationScanPolling() {
  for (const [clusterId, controller] of scanControllers.entries()) {
    stopDeprecationScanTimer(controller);
    scanControllers.delete(clusterId);
  }
}

function stopDeprecationScanTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureDeprecationScanPolling(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimeHeavyDiagnosticsActive(clusterId)) return;
  if (
    !isDashboardFeatureRouteActive(clusterId, {
      dashboardRoot: true,
      workloads: ["deprecationscan"],
    })
  ) {
    return;
  }

  void runDeprecationScan(clusterId, { source: "auto" });
  const { scheduleMs } = get(deprecationScanConfig);
  controller.timer = setInterval(() => {
    void runDeprecationScan(clusterId, { source: "auto" });
  }, scheduleMs);
}

function syncDeprecationScanPolling(clusterId: string, controller: PollController) {
  if (
    isClusterRuntimeHeavyDiagnosticsActive(clusterId) &&
    isDashboardFeatureRouteActive(clusterId, {
      dashboardRoot: true,
      workloads: ["deprecationscan"],
    })
  ) {
    ensureDeprecationScanPolling(clusterId, controller);
    return;
  }
  stopDeprecationScanTimer(controller);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of scanControllers.entries()) {
    syncDeprecationScanPolling(clusterId, controller);
  }
});

clusterRuntimeBudget.subscribe(() => {
  for (const [clusterId, controller] of scanControllers.entries()) {
    syncDeprecationScanPolling(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of scanControllers.entries()) {
    syncDeprecationScanPolling(clusterId, controller);
  }
});

export function markScanUnavailable(clusterId: string, reason: string) {
  const config = get(deprecationScanConfig);
  const nextState = ensureState(clusterId, config, "unavailable", reason);

  deprecationScanState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
}

export function setDeprecationScanTargetVersion(clusterId: string, targetVersion: string) {
  const normalized = targetVersion.trim();
  if (!clusterId) return;

  deprecationScanTargetVersionByCluster.update((state) => ({
    ...state,
    [clusterId]: normalized,
  }));

  deprecationScanState.update((state) => {
    const cluster = state[clusterId];
    if (!cluster) return state;

    return {
      ...state,
      [clusterId]: {
        ...cluster,
        summary: {
          ...cluster.summary,
          targetVersion: normalized,
        },
      },
    };
  });
}

export function getTrustLevelLabel(level: DeprecationTrustLevel): string {
  if (level === "full") return "Full coverage";
  if (level === "mixed") return "Mixed coverage";
  if (level === "observed") return "Observed only";
  return "Limited";
}

export function getStatusFromIssues(issues: DeprecationIssue[]): DeprecationStatus {
  return issueListStatus(issues);
}

export function resetDeprecationScanRuntimeState() {
  plutoMissing = {
    detected: false,
    reason: "Pluto command is unavailable",
  };
  inFlightScans.clear();
}
