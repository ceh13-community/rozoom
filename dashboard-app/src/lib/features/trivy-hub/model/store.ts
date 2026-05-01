import { browser } from "$app/environment";
import { get, writable } from "svelte/store";
import { installTrivyOperator, listHelmReleases } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";
import type { TrivyHubConfig, TrivyHubState, TrivyProvider, TrivyProviderId } from "./types";

const DEFAULT_CONFIG: TrivyHubConfig = {
  cacheTtlMs: 30 * 1000,
  scheduleMs: 30 * 1000,
};

const DEFAULT_SUMMARY: TrivyHubState["summary"] = {
  status: "unavailable",
  lastRunAt: null,
  message: "Trivy Operator is not detected",
};

const TRIVY_HUB_STATE_STORAGE_KEY = "dashboard:trivy-hub:state:v1";
const TRIVY_HUB_REPORTS_STORAGE_KEY = "dashboard:trivy-hub:reports:v1";

function loadPersistedRecord<T>(storageKey: string): Record<string, T | undefined> {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, T | undefined>;
    return typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistRecord<T>(storageKey: string, value: Record<string, T | undefined>) {
  if (!browser) return;
  try {
    if (Object.keys(value).length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // best-effort persistence
  }
}

export const trivyHubConfig = writable<TrivyHubConfig>(DEFAULT_CONFIG);
export const trivyHubState = writable<Record<string, TrivyHubState | undefined>>(
  loadPersistedRecord<TrivyHubState>(TRIVY_HUB_STATE_STORAGE_KEY),
);
export const trivyHubReports = writable<Record<string, string | undefined>>(
  loadPersistedRecord<string>(TRIVY_HUB_REPORTS_STORAGE_KEY),
);

if (browser) {
  trivyHubState.subscribe((value) => {
    persistRecord(TRIVY_HUB_STATE_STORAGE_KEY, value);
  });
  trivyHubReports.subscribe((value) => {
    persistRecord(TRIVY_HUB_REPORTS_STORAGE_KEY, value);
  });
}

function chartVersion(chart: string | undefined): string | undefined {
  if (!chart) return undefined;
  const match = chart.match(/-(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/);
  return match?.[1];
}

function isTrivyRelease(name: string, chart: string): boolean {
  const lowName = name.toLowerCase();
  const lowChart = chart.toLowerCase();
  return lowName.includes("trivy-operator") || lowChart.includes("trivy-operator");
}

function buildProvider(
  id: TrivyProviderId,
  title: string,
  docsUrl: string,
  githubUrl: string,
  release?: { name: string; namespace: string; chart: string },
): TrivyProvider {
  if (!release) {
    return {
      id,
      title,
      status: "not_installed",
      message: "",
      docsUrl,
      githubUrl,
    };
  }

  return {
    id,
    title,
    status: "installed",
    namespace: release.namespace,
    releaseName: release.name,
    chartVersion: chartVersion(release.chart),
    message: `Installed in ${release.namespace} namespace`,
    docsUrl,
    githubUrl,
  };
}

function computeSummary(
  runAt: string,
  providers: TrivyProvider[],
  errors: string[],
): TrivyHubState["summary"] {
  const installed = providers.filter((provider) => provider.status === "installed").length;
  if (errors.length > 0) {
    return { status: "degraded", lastRunAt: runAt, message: errors[0] };
  }
  if (installed === 0) {
    return {
      status: "unavailable",
      lastRunAt: runAt,
      message: "Trivy Operator is not detected",
    };
  }
  return {
    status: "ok",
    lastRunAt: runAt,
    message: "Trivy Operator is detected",
  };
}

export async function runTrivyHubScan(
  clusterId: string,
  options?: { force?: boolean; statusOnly?: boolean },
): Promise<TrivyHubState> {
  const config = get(trivyHubConfig);
  const currentState = get(trivyHubState)[clusterId];
  if (currentState?.summary.lastRunAt && !options?.force) {
    const cachedUntil = new Date(currentState.summary.lastRunAt).getTime() + config.cacheTtlMs;
    if (Date.now() < cachedUntil) return currentState;
  }

  const runAt = new Date().toISOString();
  const listed = await listHelmReleases(clusterId);
  const errors: string[] = [];
  if (listed.error) errors.push(`Helm releases: ${listed.error}`);

  const trivyRelease = listed.releases.find((release) =>
    isTrivyRelease(release.name, release.chart),
  );

  const providers: TrivyProvider[] = [
    buildProvider(
      "trivy-operator",
      "Trivy Operator",
      "https://aquasecurity.github.io/trivy-operator/",
      "https://github.com/aquasecurity/trivy-operator",
      trivyRelease,
    ),
  ];

  const summary = computeSummary(runAt, providers, errors);
  const nextState: TrivyHubState = {
    summary,
    providers,
    errors: errors.length > 0 ? errors : undefined,
  };

  trivyHubState.update((state) => ({ ...state, [clusterId]: nextState }));
  await updateClusterCheckPartially(clusterId, {
    trivySummary: {
      status: nextState.summary.status,
      lastRunAt: nextState.summary.lastRunAt,
      message: nextState.summary.message,
    },
  });
  return nextState;
}

export function markTrivyHubUnavailable(clusterId: string, reason: string) {
  const nextState: TrivyHubState = {
    summary: {
      ...DEFAULT_SUMMARY,
      message: reason,
      lastRunAt: null,
    },
    providers: [],
    errors: [reason],
  };
  trivyHubState.update((state) => ({ ...state, [clusterId]: nextState }));
}

export function setTrivyHubReport(clusterId: string, reportRaw: string) {
  trivyHubReports.update((state) => ({ ...state, [clusterId]: reportRaw }));
}

export async function installTrivyProvider(
  clusterId: string,
  providerId: TrivyProviderId,
  onOutput?: (chunk: string) => void,
): Promise<{ success: boolean; error?: string }> {
  void providerId;
  return installTrivyOperator(clusterId, undefined, onOutput);
}

function parseItemsCount(output: string): number {
  try {
    const parsed = JSON.parse(output) as { items?: unknown[] };
    return Array.isArray(parsed.items) ? parsed.items.length : 0;
  } catch {
    return 0;
  }
}

function isMissingResourceType(errorText: string): boolean {
  const low = errorText.toLowerCase();
  return (
    low.includes("doesn't have a resource type") ||
    low.includes("the server could not find the requested resource")
  );
}

function isNamespaceScopeError(errorText: string): boolean {
  const low = errorText.toLowerCase();
  return (
    low.includes("not namespace scoped") ||
    low.includes("a resource cannot be retrieved by namespace") ||
    low.includes("is not namespaced")
  );
}

async function scanResource(
  clusterId: string,
  resource: string,
): Promise<{
  resource: string;
  available: boolean;
  count: number;
  details?: {
    namespaces?: string[];
    sampleResources?: string[];
    severity?: Record<string, number>;
    checks?: { failed: number; passed: number; total: number };
  };
  error?: string;
}> {
  const parseResourceDetails = (
    output: string,
  ): {
    namespaces?: string[];
    sampleResources?: string[];
    severity?: Record<string, number>;
    checks?: { failed: number; passed: number; total: number };
  } => {
    type GenericItem = Record<string, unknown>;
    type SeverityMap = Record<string, number>;

    let items: GenericItem[] = [];
    try {
      const parsed = JSON.parse(output || "{}") as { items?: GenericItem[] };
      items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return {};
    }

    const namespaceCounts = new Map<string, number>();
    const sampleResources: string[] = [];
    const severity: SeverityMap = {};
    let checksFailed = 0;
    let checksPassed = 0;

    const addSeverity = (name: string, value: unknown) => {
      if (typeof value !== "number" || value <= 0) return;
      severity[name] = (severity[name] ?? 0) + value;
    };

    for (const item of items) {
      const metadata =
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {};
      const report =
        item.report && typeof item.report === "object"
          ? (item.report as Record<string, unknown>)
          : {};
      const summary =
        report.summary && typeof report.summary === "object"
          ? (report.summary as Record<string, unknown>)
          : {};

      const nsRaw = metadata.namespace;
      if (typeof nsRaw === "string" && nsRaw.length > 0) {
        namespaceCounts.set(nsRaw, (namespaceCounts.get(nsRaw) ?? 0) + 1);
      }

      const resourceName = typeof metadata.name === "string" ? metadata.name : "";
      const resourceNamespace = typeof metadata.namespace === "string" ? metadata.namespace : "";
      const displayName = resourceNamespace ? `${resourceNamespace}/${resourceName}` : resourceName;
      if (displayName && sampleResources.length < 5) sampleResources.push(displayName);

      addSeverity("critical", summary.criticalCount ?? summary.CriticalCount);
      addSeverity("high", summary.highCount ?? summary.HighCount);
      addSeverity("medium", summary.mediumCount ?? summary.MediumCount);
      addSeverity("low", summary.lowCount ?? summary.LowCount);
      addSeverity("unknown", summary.unknownCount ?? summary.UnknownCount);

      const checks = Array.isArray(report.checks) ? report.checks : [];
      for (const entry of checks) {
        if (!entry || typeof entry !== "object") continue;
        const check = entry as Record<string, unknown>;
        const severityName = typeof check.severity === "string" ? check.severity.toLowerCase() : "";
        const success = check.success;
        if (success === false) {
          checksFailed += 1;
          if (severityName) addSeverity(severityName, 1);
        } else if (success === true) {
          checksPassed += 1;
        }
      }
    }

    const namespaces = [...namespaceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count})`);

    return {
      namespaces: namespaces.length > 0 ? namespaces : undefined,
      sampleResources: sampleResources.length > 0 ? sampleResources : undefined,
      severity: Object.keys(severity).length > 0 ? severity : undefined,
      checks:
        checksFailed + checksPassed > 0
          ? {
              failed: checksFailed,
              passed: checksPassed,
              total: checksFailed + checksPassed,
            }
          : undefined,
    };
  };

  let result = await kubectlRawArgsFront(["get", resource, "-A", "-o", "json"], { clusterId });
  if (result.errors || result.code !== 0) {
    const err = result.errors || result.output || `Failed to query ${resource}`;
    if (isMissingResourceType(err)) {
      return { resource, available: false, count: 0 };
    }

    if (isNamespaceScopeError(err)) {
      result = await kubectlRawArgsFront(["get", resource, "-o", "json"], { clusterId });
      if (!result.errors && result.code === 0) {
        const output = result.output || "{}";
        return {
          resource,
          available: true,
          count: parseItemsCount(output),
          details: parseResourceDetails(output),
        };
      }
      const retryErr = result.errors || result.output || `Failed to query ${resource}`;
      return { resource, available: false, count: 0, error: retryErr };
    }

    return { resource, available: false, count: 0, error: err };
  }
  return {
    resource,
    available: true,
    count: parseItemsCount(result.output || "{}"),
    details: parseResourceDetails(result.output || "{}"),
  };
}

export async function runTrivyScanNow(clusterId: string): Promise<{
  success: boolean;
  error?: string;
  report?: Record<string, unknown>;
}> {
  const state = await runTrivyHubScan(clusterId, { force: true });
  const resourcesToScan = [
    "vulnerabilityreports",
    "configauditreports",
    "rbacassessmentreports",
    "clustercompliancereports",
    "clusterconfigauditreports",
    "clusterrbacassessmentreports",
    "exposedsecretreports",
  ];

  const resources = await Promise.all(
    resourcesToScan.map((resource) => scanResource(clusterId, resource)),
  );
  const scanErrors = resources
    .filter((entry) => entry.error)
    .map((entry) => `${entry.resource}: ${entry.error}`);
  const severityTotals = resources.reduce<Record<string, number>>((acc, entry) => {
    for (const [severity, count] of Object.entries(entry.details?.severity ?? {})) {
      acc[severity] = (acc[severity] ?? 0) + count;
    }
    return acc;
  }, {});
  const checksTotals = resources.reduce(
    (acc, entry) => {
      if (!entry.details?.checks) return acc;
      acc.failed += entry.details.checks.failed;
      acc.passed += entry.details.checks.passed;
      acc.total += entry.details.checks.total;
      return acc;
    },
    { failed: 0, passed: 0, total: 0 },
  );

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    clusterId,
    summary: {
      providersInstalled: state.providers.filter((provider) => provider.status === "installed")
        .length,
      findings: resources.reduce((sum, entry) => sum + entry.count, 0),
      errors: scanErrors.length,
      severity: severityTotals,
      checks: checksTotals,
    },
    providers: state.providers.map((provider) => ({
      id: provider.id,
      status: provider.status,
      namespace: provider.namespace ?? null,
      releaseName: provider.releaseName ?? null,
    })),
    resources,
    errors: scanErrors,
  };

  setTrivyHubReport(clusterId, JSON.stringify(report, null, 2));
  return { success: true, report };
}
