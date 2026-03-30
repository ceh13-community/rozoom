import { browser } from "$app/environment";
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
import { installKubeArmor } from "$shared/api/helm";
import { listHelmReleases } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";
import {
  shouldSkipFeatureProbe,
  markFeatureCapabilityFromReason,
} from "$features/check-health/model/feature-capability-cache";
import type { ArmorHubConfig, ArmorHubState, ArmorProvider, ArmorProviderId } from "./types";

const DEFAULT_CONFIG: ArmorHubConfig = {
  cacheTtlMs: 30 * 1000,
  scheduleMs: 30 * 1000,
};

const DEFAULT_SUMMARY: ArmorHubState["summary"] = {
  status: "unavailable",
  lastRunAt: null,
  message: "KubeArmor is not detected",
};

export const armorHubConfig = writable<ArmorHubConfig>(DEFAULT_CONFIG);
const ARMOR_HUB_STATE_STORAGE_KEY = "dashboard:armor-hub:state:v1";
const ARMOR_HUB_REPORTS_STORAGE_KEY = "dashboard:armor-hub:reports:v1";

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

export const armorHubState = writable<Record<string, ArmorHubState | undefined>>(
  loadPersistedRecord<ArmorHubState>(ARMOR_HUB_STATE_STORAGE_KEY),
);
export const armorHubReports = writable<Record<string, string | undefined>>(
  loadPersistedRecord<string>(ARMOR_HUB_REPORTS_STORAGE_KEY),
);

if (browser) {
  armorHubState.subscribe((value) => {
    persistRecord(ARMOR_HUB_STATE_STORAGE_KEY, value);
  });
  armorHubReports.subscribe((value) => {
    persistRecord(ARMOR_HUB_REPORTS_STORAGE_KEY, value);
  });
}

type PollController = {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
};

const pollControllers = new Map<string, PollController>();

function chartVersion(chart: string | undefined): string | undefined {
  if (!chart) return undefined;
  const match = chart.match(/-(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/);
  return match?.[1];
}

function isKubearmorRelease(name: string, chart: string): boolean {
  const lowName = name.toLowerCase();
  const lowChart = chart.toLowerCase();
  return lowName.includes("kubearmor") || lowChart.includes("kubearmor");
}

function buildProvider(
  id: ArmorProviderId,
  title: string,
  docsUrl: string,
  githubUrl: string,
  release?: { name: string; namespace: string; chart: string },
): ArmorProvider {
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
  providers: ArmorProvider[],
  errors: string[],
): ArmorHubState["summary"] {
  const installed = providers.filter((provider) => provider.status === "installed").length;
  if (errors.length > 0) {
    return { status: "degraded", lastRunAt: runAt, message: errors[0] };
  }
  if (installed === 0) {
    return {
      status: "unavailable",
      lastRunAt: runAt,
      message: "KubeArmor is not detected",
    };
  }
  return {
    status: "ok",
    lastRunAt: runAt,
    message: "KubeArmor is detected",
  };
}

export async function runArmorHubScan(
  clusterId: string,
  options?: { force?: boolean; statusOnly?: boolean },
): Promise<ArmorHubState> {
  const config = get(armorHubConfig);
  const currentState = get(armorHubState)[clusterId];
  if (currentState?.summary.lastRunAt && !options?.force) {
    const cachedUntil = new Date(currentState.summary.lastRunAt).getTime() + config.cacheTtlMs;
    if (Date.now() < cachedUntil) return currentState;
  }

  const runAt = new Date().toISOString();
  const listed = await listHelmReleases(clusterId);
  const errors: string[] = [];
  if (listed.error) errors.push(`Helm releases: ${listed.error}`);

  const kubearmorRelease = listed.releases.find((release) =>
    isKubearmorRelease(release.name, release.chart),
  );

  const providers: ArmorProvider[] = [
    buildProvider(
      "kubearmor",
      "KubeArmor",
      "https://docs.kubearmor.io/",
      "https://github.com/kubearmor/KubeArmor",
      kubearmorRelease,
    ),
  ];

  const summary = computeSummary(runAt, providers, errors);
  const nextState: ArmorHubState = {
    summary,
    providers,
    errors: errors.length > 0 ? errors : undefined,
  };

  armorHubState.update((state) => ({ ...state, [clusterId]: nextState }));
  await updateClusterCheckPartially(clusterId, {
    armorSummary: {
      status: nextState.summary.status,
      lastRunAt: nextState.summary.lastRunAt,
      message: nextState.summary.message,
    },
  });
  return nextState;
}

export function startArmorHubPolling(clusterId: string) {
  if (!clusterId) return;
  const existing = pollControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureArmorHubPolling(clusterId, existing);
    return;
  }

  const controller: PollController = { refCount: 1, timer: null };
  pollControllers.set(clusterId, controller);
  ensureArmorHubPolling(clusterId, controller);
}

export function stopArmorHubPolling(clusterId: string) {
  const controller = pollControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopArmorHubTimer(controller);
  pollControllers.delete(clusterId);
}

export function stopAllArmorHubPolling() {
  for (const [clusterId, controller] of pollControllers.entries()) {
    stopArmorHubTimer(controller);
    pollControllers.delete(clusterId);
  }
}

function stopArmorHubTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureArmorHubPolling(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimeHeavyDiagnosticsActive(clusterId)) return;
  if (!isDashboardFeatureRouteActive(clusterId, { workloads: ["armorhub"] })) return;

  void runArmorHubScan(clusterId, { force: true });
  const { scheduleMs } = get(armorHubConfig);
  controller.timer = setInterval(() => {
    void runArmorHubScan(clusterId, { force: true });
  }, scheduleMs);
}

function syncArmorHubPolling(clusterId: string, controller: PollController) {
  if (
    isClusterRuntimeHeavyDiagnosticsActive(clusterId) &&
    isDashboardFeatureRouteActive(clusterId, { workloads: ["armorhub"] })
  ) {
    ensureArmorHubPolling(clusterId, controller);
    return;
  }
  stopArmorHubTimer(controller);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncArmorHubPolling(clusterId, controller);
  }
});

clusterRuntimeBudget.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncArmorHubPolling(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncArmorHubPolling(clusterId, controller);
  }
});

export function markArmorHubUnavailable(clusterId: string, reason: string) {
  const nextState: ArmorHubState = {
    summary: {
      ...DEFAULT_SUMMARY,
      message: reason,
      lastRunAt: null,
    },
    providers: [],
    errors: [reason],
  };
  armorHubState.update((state) => ({ ...state, [clusterId]: nextState }));
}

export function setArmorHubReport(clusterId: string, reportRaw: string) {
  armorHubReports.update((state) => ({ ...state, [clusterId]: reportRaw }));
}

export async function installArmorProvider(
  clusterId: string,
  providerId: ArmorProviderId,
): Promise<{ success: boolean; error?: string }> {
  void providerId;
  return installKubeArmor(clusterId);
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
  };
  error?: string;
}> {
  const parseResourceDetails = (
    output: string,
  ): {
    namespaces?: string[];
    sampleResources?: string[];
    severity?: Record<string, number>;
  } => {
    type GenericItem = Record<string, unknown>;
    let items: GenericItem[] = [];
    try {
      const parsed = JSON.parse(output || "{}") as { items?: GenericItem[] };
      items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return {};
    }

    const namespaceCounts = new Map<string, number>();
    const sampleResources: string[] = [];
    const severity: Record<string, number> = {};

    for (const item of items) {
      const metadata =
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {};
      const nsRaw = metadata.namespace;
      if (typeof nsRaw === "string" && nsRaw.length > 0) {
        namespaceCounts.set(nsRaw, (namespaceCounts.get(nsRaw) ?? 0) + 1);
      }

      const resourceName = typeof metadata.name === "string" ? metadata.name : "";
      const resourceNamespace = typeof metadata.namespace === "string" ? metadata.namespace : "";
      const displayName = resourceNamespace ? `${resourceNamespace}/${resourceName}` : resourceName;
      if (displayName && sampleResources.length < 5) sampleResources.push(displayName);

      const severityRaw =
        item.severity ??
        (item.alert && typeof item.alert === "object"
          ? (item.alert as Record<string, unknown>).severity
          : undefined) ??
        (item.status && typeof item.status === "object"
          ? (item.status as Record<string, unknown>).severity
          : undefined);
      if (typeof severityRaw === "string" && severityRaw.length > 0) {
        const key = severityRaw.toLowerCase();
        severity[key] = (severity[key] ?? 0) + 1;
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

const KUBEARMOR_FEATURE_ID = "kubearmor-crds";

export async function runArmorScanNow(clusterId: string): Promise<{
  success: boolean;
  error?: string;
  report?: Record<string, unknown>;
}> {
  if (
    shouldSkipFeatureProbe(clusterId, KUBEARMOR_FEATURE_ID, {
      statuses: ["unsupported"],
    })
  ) {
    return {
      success: true,
      report: { skipped: true, reason: "KubeArmor CRDs not installed (cached)" },
    };
  }

  const state = await runArmorHubScan(clusterId, { force: true });
  const crdResult = await kubectlRawArgsFront(["get", "crd", "-o", "json"], { clusterId });
  const crdError = crdResult.errors || (crdResult.code !== 0 ? crdResult.output : "");

  let kubearmorCrds: string[] = [];
  if (!crdError) {
    try {
      const parsed = JSON.parse(crdResult.output || "{}") as {
        items?: Array<{ metadata?: { name?: string } }>;
      };
      const names = (parsed.items ?? []).map((item) => item.metadata?.name || "").filter(Boolean);
      kubearmorCrds = names.filter((name) => name.toLowerCase().includes("kubearmor"));
    } catch {
      // best-effort
    }
  }

  if (kubearmorCrds.length === 0 && !crdError) {
    markFeatureCapabilityFromReason(
      clusterId,
      KUBEARMOR_FEATURE_ID,
      "KubeArmor CRDs not installed on this cluster",
    );
    return { success: true, report: { skipped: true, reason: "No KubeArmor CRDs found" } };
  }

  const resourcesToScan = [
    "kubearmorpolicies",
    "kubearmorclusterpolicies",
    "kubearmorhostpolicies",
    "kubearmoralerts",
    ...kubearmorCrds,
  ].filter((value, index, array) => array.indexOf(value) === index);

  const resources = await Promise.all(
    resourcesToScan.map((resource) => scanResource(clusterId, resource)),
  );

  const scanErrors = resources
    .filter((entry) => entry.error)
    .map((entry) => `${entry.resource}: ${entry.error}`);
  if (crdError) {
    scanErrors.push(`crd: ${crdError}`);
  }

  const policyCount = resources
    .filter((entry) => entry.resource !== "kubearmoralerts")
    .reduce((sum, entry) => sum + entry.count, 0);
  const alertCount = resources
    .filter((entry) => entry.resource === "kubearmoralerts")
    .reduce((sum, entry) => sum + entry.count, 0);
  const severityTotals = resources.reduce<Record<string, number>>((acc, entry) => {
    for (const [severity, count] of Object.entries(entry.details?.severity ?? {})) {
      acc[severity] = (acc[severity] ?? 0) + count;
    }
    return acc;
  }, {});

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    clusterId,
    summary: {
      providersInstalled: state.providers.filter((provider) => provider.status === "installed")
        .length,
      policies: policyCount,
      alerts: alertCount,
      errors: scanErrors.length,
      severity: severityTotals,
    },
    providers: state.providers.map((provider) => ({
      id: provider.id,
      status: provider.status,
      namespace: provider.namespace ?? null,
      releaseName: provider.releaseName ?? null,
    })),
    crds: {
      kubearmor: kubearmorCrds,
    },
    resources,
    errors: scanErrors,
  };

  setArmorHubReport(clusterId, JSON.stringify(report, null, 2));

  return { success: true, report };
}
