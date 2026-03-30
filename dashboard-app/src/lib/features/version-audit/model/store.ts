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
import { fetchClusterVersion } from "$shared/api/cluster-version";
import { listHelmReleases } from "$shared/api/helm";
import { execCli } from "$shared/api/cli";
import type {
  ClusterVersionAuditState,
  HelmChartInfo,
  K8sVersionInfo,
  K8sVersionStatus,
  VersionAuditConfig,
  VersionAuditRun,
  VersionAuditSummary,
} from "./types";

const DEFAULT_CONFIG: VersionAuditConfig = {
  minSupportedVersion: "v1.25.0",
  cacheTtlMs: 10 * 60 * 1000,
  scheduleMs: 10 * 60 * 1000,
};

const MAX_HISTORY = 5;
const VERSION_AUDIT_STORAGE_KEY = "rozoom:version-audit-state:v1";

const DEFAULT_SUMMARY: VersionAuditSummary = {
  k8sStatus: "unreachable",
  k8sVersion: null,
  minSupported: DEFAULT_CONFIG.minSupportedVersion,
  chartStatus: "unknown",
  outdatedCharts: 0,
  totalCharts: 0,
  lastRunAt: null,
  cacheExpiresAt: null,
  message: "Version audit unavailable",
};

export const versionAuditConfig = writable<VersionAuditConfig>(DEFAULT_CONFIG);
function readPersistedVersionAuditState(): Record<string, ClusterVersionAuditState | undefined> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VERSION_AUDIT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ClusterVersionAuditState | undefined>;
  } catch {
    return {};
  }
}

export const versionAuditState = writable<Record<string, ClusterVersionAuditState | undefined>>(
  readPersistedVersionAuditState(),
);

if (typeof window !== "undefined") {
  versionAuditState.subscribe((state) => {
    try {
      window.localStorage.setItem(VERSION_AUDIT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage write errors
    }
  });
}

type PollController = {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
};

const auditControllers = new Map<string, PollController>();
const inFlightAudits = new Map<string, Promise<VersionAuditSummary>>();

function parseSemver(version: string): [number, number, number] {
  const normalized = version.replace(/^v/, "");
  const [major, minor, patch] = normalized.split(".").map((value) => Number.parseInt(value, 10));
  return [major || 0, minor || 0, patch || 0];
}

function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

function getK8sStatus(version: K8sVersionInfo | null, minSupported: string): K8sVersionStatus {
  if (!version) return "unreachable";

  const diff = compareSemver(version.gitVersion, minSupported);
  if (diff < 0) return "unsupported";
  if (diff === 0) return "outdated";
  return "ok";
}

function buildSummary(run: VersionAuditRun, cacheTtlMs: number): VersionAuditSummary {
  const cacheExpiresAt = new Date(new Date(run.runAt).getTime() + cacheTtlMs).toISOString();
  const chartStatus = run.charts.length ? (run.outdatedCharts > 0 ? "warning" : "ok") : "unknown";
  const k8sVersion = run.k8s.version?.gitVersion ?? null;
  const statusLabel = run.k8s.status === "ok" ? "Supported" : run.k8s.status;
  const message = `K8s ${k8sVersion ?? "unknown"} · ${statusLabel}`;

  return {
    k8sStatus: run.k8s.status,
    k8sVersion,
    minSupported: run.k8s.minSupported,
    chartStatus,
    outdatedCharts: run.outdatedCharts,
    totalCharts: run.charts.length,
    lastRunAt: run.runAt,
    cacheExpiresAt,
    message,
    errors: run.errors,
  };
}

function parseHelmChartVersion(chart: string): string {
  const match = chart.match(/-(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/);
  return match?.[1] ?? chart;
}

function parseHelmChartName(chart: string): string {
  const match = chart.match(/^(.*)-\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
  return (match?.[1] ?? chart).trim();
}

function normalizeHelmVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

async function resolveLatestChartVersion(chartName: string): Promise<{
  latest: string | null;
  error?: string;
}> {
  try {
    const result = await execCli("helm", ["search", "repo", chartName, "--versions", "-o", "json"]);
    if (result.code !== 0) {
      return { latest: null, error: result.stderr.trim() || "helm search repo failed" };
    }

    const payload = JSON.parse(result.stdout || "[]") as Array<{ name?: string; version?: string }>;
    const candidates = payload
      .filter(
        (entry) =>
          entry.version && entry.name?.toLowerCase().endsWith(`/${chartName.toLowerCase()}`),
      )
      .map((entry) => entry.version as string);

    if (candidates.length === 0) {
      return { latest: null, error: "Chart was not found in configured Helm repositories" };
    }

    const latest = [...candidates].sort((a, b) =>
      compareSemver(normalizeHelmVersion(b), normalizeHelmVersion(a)),
    )[0];
    return { latest };
  } catch (error) {
    return {
      latest: null,
      error: error instanceof Error ? error.message : "Failed to resolve latest chart version",
    };
  }
}

async function buildRun(
  clusterId: string,
  config: VersionAuditConfig,
  source: "auto" | "manual",
): Promise<{ run: VersionAuditRun }> {
  const runAt = new Date().toISOString();
  const versionResult = await fetchClusterVersion(clusterId, {
    force: source === "manual",
    cacheTtlMs: config.cacheTtlMs,
  });
  const version = versionResult.version as K8sVersionInfo | null;
  const errors = [...versionResult.errors];

  const k8sStatus = getK8sStatus(version, config.minSupportedVersion);
  const helmResult = await listHelmReleases(clusterId);
  if (helmResult.error) {
    errors.push(helmResult.error);
  }
  const chartNames = new Set<string>();
  const parsedReleases = helmResult.releases.map((release) => {
    const chartName = parseHelmChartName(release.chart);
    const versionValue = parseHelmChartVersion(release.chart);
    if (chartName) chartNames.add(chartName);
    return { release, chartName, versionValue };
  });

  const latestByChartName = new Map<string, { latest: string | null; error?: string }>();
  for (const chartName of chartNames) {
    const latest = await resolveLatestChartVersion(chartName);
    latestByChartName.set(chartName, latest);
    if (latest.error && latest.error !== "Chart was not found in configured Helm repositories") {
      errors.push(`Helm lookup (${chartName}): ${latest.error}`);
    }
  }

  const charts: HelmChartInfo[] = parsedReleases.map(({ release, chartName, versionValue }) => {
    const latestMeta = latestByChartName.get(chartName);
    const installedVersion = normalizeHelmVersion(versionValue);
    const latestVersion = latestMeta?.latest ? normalizeHelmVersion(latestMeta.latest) : null;

    let status: HelmChartInfo["status"] = "unknown";
    if (latestVersion) {
      status = compareSemver(installedVersion, latestVersion) < 0 ? "outdated" : "up-to-date";
    }

    const releaseStateError =
      release.status && release.status.toLowerCase() !== "deployed"
        ? `Release status: ${release.status}`
        : undefined;

    return {
      name: release.name,
      namespace: release.namespace,
      version: versionValue,
      latest: latestMeta?.latest ?? null,
      status,
      error: latestMeta?.error ?? releaseStateError,
    };
  });
  const outdatedCharts = charts.filter((chart) => chart.status === "outdated").length;

  return {
    run: {
      id: `${clusterId}-${runAt}`,
      runAt,
      k8s: {
        version,
        minSupported: config.minSupportedVersion,
        status: k8sStatus,
        message: version
          ? `Server ${version.gitVersion} compared to ${config.minSupportedVersion}`
          : `Unable to resolve server version (${errors[0] ?? "unknown error"})`,
      },
      charts,
      outdatedCharts,
      source,
      errors: errors.length ? errors : undefined,
    },
  };
}

function ensureState(config: VersionAuditConfig, message: string): ClusterVersionAuditState {
  return {
    summary: {
      ...DEFAULT_SUMMARY,
      minSupported: config.minSupportedVersion,
      message,
    },
    history: [],
  };
}

export async function runVersionAudit(
  clusterId: string,
  options?: { force?: boolean; source?: "auto" | "manual" },
): Promise<VersionAuditSummary> {
  const inFlight = inFlightAudits.get(clusterId);
  if (inFlight) {
    return inFlight;
  }

  const runPromise = (async () => {
    const config = get(versionAuditConfig);
    const currentState = get(versionAuditState)[clusterId];

    if (currentState?.summary.lastRunAt && !options?.force) {
      const cachedUntil = currentState.summary.cacheExpiresAt
        ? new Date(currentState.summary.cacheExpiresAt).getTime()
        : 0;
      if (Date.now() < cachedUntil) {
        return currentState.summary;
      }
    }

    const { run } = await buildRun(clusterId, config, options?.source ?? "auto");
    const summary = buildSummary(run, config.cacheTtlMs);
    const nextHistory = [run, ...(currentState?.history ?? [])].slice(0, MAX_HISTORY);

    versionAuditState.update((state) => ({
      ...state,
      [clusterId]: {
        summary,
        history: nextHistory,
      },
    }));

    return summary;
  })().finally(() => {
    if (inFlightAudits.get(clusterId) === runPromise) {
      inFlightAudits.delete(clusterId);
    }
  });

  inFlightAudits.set(clusterId, runPromise);
  return runPromise;
}

export function startVersionAuditPolling(clusterId: string) {
  if (!clusterId) return;

  const existing = auditControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureVersionAuditPolling(clusterId, existing);
    return;
  }

  const controller: PollController = { refCount: 1, timer: null };
  auditControllers.set(clusterId, controller);
  ensureVersionAuditPolling(clusterId, controller);
}

export function stopVersionAuditPolling(clusterId: string) {
  const controller = auditControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopVersionAuditTimer(controller);
  auditControllers.delete(clusterId);
}

export function stopAllVersionAuditPolling() {
  for (const [clusterId, controller] of auditControllers.entries()) {
    stopVersionAuditTimer(controller);
    auditControllers.delete(clusterId);
  }
}

function stopVersionAuditTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureVersionAuditPolling(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimeHeavyDiagnosticsActive(clusterId)) return;
  if (
    !isDashboardFeatureRouteActive(clusterId, { dashboardRoot: true, workloads: ["versionaudit"] })
  ) {
    return;
  }

  void runVersionAudit(clusterId, { source: "auto" });
  const { scheduleMs } = get(versionAuditConfig);
  controller.timer = setInterval(() => {
    void runVersionAudit(clusterId, { source: "auto" });
  }, scheduleMs);
}

function syncVersionAuditPolling(clusterId: string, controller: PollController) {
  if (
    isClusterRuntimeHeavyDiagnosticsActive(clusterId) &&
    isDashboardFeatureRouteActive(clusterId, { dashboardRoot: true, workloads: ["versionaudit"] })
  ) {
    ensureVersionAuditPolling(clusterId, controller);
    return;
  }
  stopVersionAuditTimer(controller);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of auditControllers.entries()) {
    syncVersionAuditPolling(clusterId, controller);
  }
});

clusterRuntimeBudget.subscribe(() => {
  for (const [clusterId, controller] of auditControllers.entries()) {
    syncVersionAuditPolling(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of auditControllers.entries()) {
    syncVersionAuditPolling(clusterId, controller);
  }
});

export function markVersionAuditUnavailable(clusterId: string, reason: string) {
  const config = get(versionAuditConfig);
  const nextState = ensureState(config, reason);

  versionAuditState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
}
