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
import { appDataDir } from "@tauri-apps/api/path";
import { BaseDirectory, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  getKubeBenchRelease,
  getKubescapeRelease,
  installKubescape,
  type HelmListedRelease,
} from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { CONFIG_DIR } from "$entities/config/model/appConfig";
import { clusterKey } from "$shared/lib/cluster-key";
import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";
import type {
  ComplianceFinding,
  ComplianceFindingDetails,
  ComplianceFindingSeverity,
  ComplianceHubConfig,
  ComplianceHubState,
  ComplianceProvider,
  ComplianceProviderId,
} from "./types";

const DEFAULT_CONFIG: ComplianceHubConfig = {
  cacheTtlMs: 30 * 1000,
  scheduleMs: 30 * 1000,
};

const DEFAULT_SUMMARY: ComplianceHubState["summary"] = {
  status: "unavailable",
  lastRunAt: null,
  message: "Compliance providers are not installed",
};

export const complianceHubConfig = writable<ComplianceHubConfig>(DEFAULT_CONFIG);
const COMPLIANCE_HUB_STATE_STORAGE_KEY = "dashboard:compliance-hub:state:v1";

function loadPersistedComplianceState(): Record<string, ComplianceHubState | undefined> {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(COMPLIANCE_HUB_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ComplianceHubState | undefined>;
    return typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistComplianceState(value: Record<string, ComplianceHubState | undefined>) {
  if (!browser) return;
  try {
    if (Object.keys(value).length === 0) {
      localStorage.removeItem(COMPLIANCE_HUB_STATE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(COMPLIANCE_HUB_STATE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best-effort persistence
  }
}

export const complianceHubState = writable<Record<string, ComplianceHubState | undefined>>(
  loadPersistedComplianceState(),
);

if (browser) {
  complianceHubState.subscribe((value) => {
    persistComplianceState(value);
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

function buildProvider(
  id: ComplianceProviderId,
  title: string,
  release: HelmListedRelease | undefined,
  error?: string,
): ComplianceProvider {
  if (error) {
    return {
      id,
      title,
      status: "error",
      message: error,
    };
  }

  if (!release) {
    return {
      id,
      title,
      status: "not_installed",
      message: "",
    };
  }

  const version = chartVersion(release.chart);
  return {
    id,
    title,
    status: "installed",
    namespace: release.namespace,
    releaseName: release.name,
    chartVersion: version,
    message: `Installed in ${release.namespace} namespace${version ? ` (v${version})` : ""}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getNumber(paths: string[][], source: Record<string, unknown>): number {
  for (const path of paths) {
    let current: unknown = source;
    let missing = false;
    for (const key of path) {
      current = asRecord(current)[key];
      if (current === undefined) {
        missing = true;
        break;
      }
    }
    if (!missing && typeof current === "number") {
      return current;
    }
  }
  return 0;
}

function getObject(
  paths: string[][],
  source: Record<string, unknown>,
): Record<string, unknown> | undefined {
  for (const path of paths) {
    let current: unknown = source;
    let missing = false;
    for (const key of path) {
      current = asRecord(current)[key];
      if (current === undefined) {
        missing = true;
        break;
      }
    }
    if (!missing && current && typeof current === "object" && !Array.isArray(current)) {
      return current as Record<string, unknown>;
    }
  }
  return undefined;
}

function getArray(paths: string[][], source: Record<string, unknown>): unknown[] | undefined {
  for (const path of paths) {
    let current: unknown = source;
    let missing = false;
    for (const key of path) {
      current = asRecord(current)[key];
      if (current === undefined) {
        missing = true;
        break;
      }
    }
    if (!missing && Array.isArray(current)) {
      return current as unknown[];
    }
  }
  return undefined;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function parseControlsDetails(
  source: Record<string, unknown>,
): ComplianceFindingDetails | undefined {
  const controlsRaw =
    getArray(
      [["Controls"], ["controls"], ["summaryDetails", "controls"], ["details", "controls"]],
      source,
    ) ?? [];
  const totalsRaw = getObject(
    [["Totals"], ["totals"], ["summaryDetails", "totals"], ["details", "totals"]],
    source,
  );

  const controls = asArray(controlsRaw)
    .flatMap((entry) => {
      const item = asRecord(entry);
      const nestedTests = getArray([["tests"]], item) ?? [];
      const mapped = (raw: Record<string, unknown>) => {
        const id =
          (raw.section as string | undefined) ||
          (raw.test_number as string | undefined) ||
          (raw.id as string | undefined) ||
          (raw.name as string | undefined) ||
          "control";
        const desc =
          (raw.desc as string | undefined) ||
          (raw.test_desc as string | undefined) ||
          (raw.text as string | undefined);
        return {
          id,
          desc,
          pass: getNumber([["pass"], ["passed"], ["total_pass"]], raw),
          fail: getNumber([["fail"], ["failed"], ["total_fail"]], raw),
          warn: getNumber([["warn"], ["warning"], ["total_warn"]], raw),
          info: getNumber([["info"], ["total_info"]], raw),
        };
      };

      if (nestedTests.length > 0) {
        return nestedTests.map((test) => mapped(asRecord(test)));
      }

      return [mapped(item)];
    })
    .filter((item) => item.id || item.pass || item.fail || item.warn || item.info);

  const totals = totalsRaw
    ? {
        pass: getNumber([["pass"], ["passed"], ["total_pass"]], totalsRaw),
        fail: getNumber([["fail"], ["failed"], ["total_fail"]], totalsRaw),
        warn: getNumber([["warn"], ["warning"], ["total_warn"]], totalsRaw),
        info: getNumber([["info"], ["total_info"]], totalsRaw),
      }
    : undefined;

  if (!totals && controls.length === 0) return undefined;
  return {
    controls: controls.length > 0 ? controls : undefined,
    totals,
  };
}

function severityFromFailureCount(failed: number): ComplianceFindingSeverity {
  if (failed >= 20) return "critical";
  if (failed >= 10) return "high";
  if (failed >= 5) return "medium";
  if (failed > 0) return "low";
  return "info";
}

function parseKubescapeFindings(output: string): ComplianceFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output || "{}");
  } catch {
    return [];
  }

  const items = Array.isArray(asRecord(parsed).items) ? (asRecord(parsed).items as unknown[]) : [];

  if (items.length === 0) {
    const source = asRecord(parsed);
    const details = parseControlsDetails(source);
    if (!details) return [];

    const failed = details.totals?.fail ?? 0;
    const passed = details.totals?.pass ?? 0;
    const title =
      (source.text as string | undefined) ||
      (source.name as string | undefined) ||
      "Kubescape manual result";
    const frameworkVersion =
      scalarText(source.detected_version) ?? scalarText(source.version) ?? "unknown";
    const framework = `CIS ${frameworkVersion}`;

    return [
      {
        id: `kubescape-controls-${title.toLowerCase().replace(/\s+/g, "-")}`,
        provider: "kubescape",
        severity: severityFromFailureCount(failed),
        framework,
        control: title,
        phase: "Completed",
        message: `${failed} failed · ${passed} passed`,
        details,
        updatedAt: new Date().toISOString(),
      } satisfies ComplianceFinding,
    ];
  }

  return items
    .map<ComplianceFinding | null>((item, index) => {
      const itemObj = asRecord(item);
      const metadata = asRecord(itemObj.metadata);
      const status = asRecord(itemObj.status);

      const failed = getNumber(
        [["summaryDetails", "failed"], ["summary", "failed"], ["failCount"], ["failed"]],
        status,
      );
      const passed = getNumber(
        [["summaryDetails", "passed"], ["summary", "passed"], ["passCount"], ["passed"]],
        status,
      );

      const framework =
        (status.framework as string | undefined) ||
        (asRecord(itemObj.spec).framework as string | undefined) ||
        "Kubescape";

      const updatedAt =
        (status.lastScanTime as string | undefined) ||
        (status.lastUpdated as string | undefined) ||
        (metadata.creationTimestamp as string | undefined) ||
        new Date().toISOString();

      const name = (metadata.name as string | undefined) || `scan-${index + 1}`;
      const namespace = metadata.namespace as string | undefined;
      const phase =
        (status.phase as string | undefined) || (status.state as string | undefined) || "Unknown";
      const details = parseControlsDetails(status) ?? parseControlsDetails(itemObj);
      const failedFromDetails = details?.totals?.fail ?? 0;
      const passedFromDetails = details?.totals?.pass ?? 0;
      const message =
        failed === 0 && passed === 0 && details?.totals
          ? `${failedFromDetails} failed · ${passedFromDetails} passed`
          : `${failed} failed · ${passed} passed`;

      const severityBase = failed === 0 && details?.totals ? failedFromDetails : failed;
      const noSignal =
        failed === 0 &&
        passed === 0 &&
        failedFromDetails === 0 &&
        passedFromDetails === 0 &&
        (!details?.controls || details.controls.length === 0);
      if (noSignal && phase.toLowerCase() === "unknown") {
        return null;
      }

      return {
        id: `kubescape-${name}-${index}`,
        provider: "kubescape",
        severity: severityFromFailureCount(severityBase),
        framework,
        control: name,
        namespace,
        phase,
        message: message.trim().length > 0 ? message : "No summary reported",
        details,
        updatedAt,
      } satisfies ComplianceFinding;
    })
    .filter((finding): finding is ComplianceFinding => finding !== null);
}

function parseKubescapeVulnerabilityFindings(output: string, kind: string): ComplianceFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output || "{}");
  } catch {
    return [];
  }

  const items = Array.isArray(asRecord(parsed).items) ? (asRecord(parsed).items as unknown[]) : [];
  return items.map((item, index) => {
    const itemObj = asRecord(item);
    const metadata = asRecord(itemObj.metadata);
    const status = asRecord(itemObj.status);
    const summary = asRecord(status.summary);
    const severity = asRecord(summary.severityCount);

    const critical = getNumber([["critical"], ["criticalCount"]], severity);
    const high = getNumber([["high"], ["highCount"]], severity);
    const medium = getNumber([["medium"], ["mediumCount"]], severity);
    const low = getNumber([["low"], ["lowCount"]], severity);
    const total = critical + high + medium + low;
    const topSeverity: ComplianceFindingSeverity =
      critical > 0
        ? "critical"
        : high > 0
          ? "high"
          : medium > 0
            ? "medium"
            : low > 0
              ? "low"
              : "info";

    const updatedAt =
      (status.lastTimeFound as string | undefined) ||
      (status.lastUpdated as string | undefined) ||
      (metadata.creationTimestamp as string | undefined) ||
      new Date().toISOString();

    const name = (metadata.name as string | undefined) || `${kind}-${index + 1}`;
    const namespace = metadata.namespace as string | undefined;
    return {
      id: `kubescape-${kind}-${name}-${index}`,
      provider: "kubescape",
      severity: topSeverity,
      framework: "Kubescape Vulnerability",
      control: name,
      namespace,
      phase: "Completed",
      message: `${total} vulnerabilities · C:${critical} H:${high} M:${medium} L:${low}`,
      updatedAt,
    } satisfies ComplianceFinding;
  });
}

function pickLatestFindings(findings: ComplianceFinding[]): ComplianceFinding[] {
  if (findings.length <= 1) return findings;
  const toTime = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const latest = findings.reduce((current, next) =>
    toTime(next.updatedAt) > toTime(current.updatedAt) ? next : current,
  );
  return [latest];
}

interface KubeBenchJobMeta {
  name: string;
  namespace: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  active?: number;
  succeeded?: number;
  failed?: number;
  phase: "Running" | "Completed" | "Failed" | "Unknown";
}

async function fetchLatestKubeBenchJobMeta(clusterId: string): Promise<{
  job?: KubeBenchJobMeta;
  error?: string;
}> {
  const jobsResult = await kubectlRawArgsFront(
    ["get", "jobs", "-A", "-l", "app.kubernetes.io/name=kube-bench", "-o", "json"],
    { clusterId },
  );
  if (jobsResult.errors || jobsResult.code !== 0) {
    return {
      error: jobsResult.errors || jobsResult.output || "Failed to list kube-bench jobs",
    };
  }

  type JobItem = {
    metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
    status?: {
      active?: number;
      succeeded?: number;
      failed?: number;
      startTime?: string;
      completionTime?: string;
      conditions?: Array<{ type?: string; status?: string }>;
    };
  };

  let jobs: JobItem[] = [];
  try {
    const parsed = JSON.parse(jobsResult.output || "{}") as { items?: JobItem[] };
    jobs = parsed.items ?? [];
  } catch {
    return { error: "Failed to parse kube-bench jobs response" };
  }

  if (jobs.length === 0) return {};

  const latest = [...jobs].sort((a, b) =>
    (b.metadata?.creationTimestamp || "").localeCompare(a.metadata?.creationTimestamp || ""),
  )[0];
  const name = latest.metadata?.name;
  const namespace = latest.metadata?.namespace;
  const createdAt = latest.metadata?.creationTimestamp;
  if (!name || !namespace || !createdAt)
    return { error: "Unable to resolve latest kube-bench job metadata." };

  const status = latest.status ?? {};
  const succeeded = status.succeeded ?? 0;
  const failed = status.failed ?? 0;
  const active = status.active ?? 0;
  const isComplete = (status.conditions ?? []).some(
    (condition) => condition.type === "Complete" && condition.status === "True",
  );
  const isFailed = (status.conditions ?? []).some(
    (condition) => condition.type === "Failed" && condition.status === "True",
  );
  const phase: KubeBenchJobMeta["phase"] =
    isFailed || failed > 0
      ? "Failed"
      : isComplete || succeeded > 0
        ? "Completed"
        : active > 0
          ? "Running"
          : "Unknown";

  return {
    job: {
      name,
      namespace,
      createdAt,
      startedAt: status.startTime,
      completedAt: status.completionTime,
      active,
      succeeded,
      failed,
      phase,
    },
  };
}

async function fetchKubescapeFindings(clusterId: string): Promise<{
  findings: ComplianceFinding[];
  error?: string;
}> {
  const scanCommands: string[][] = [
    ["get", "workloadconfigurationscansummaries", "-A", "-o", "json"],
    ["get", "workloadconfigurationscans", "-A", "-o", "json"],
  ];

  const errors: string[] = [];
  for (const args of scanCommands) {
    const result = await kubectlRawArgsFront(args, { clusterId });
    if (result.errors || result.code !== 0) {
      errors.push(result.errors || result.output || "Failed to query Kubescape scan summaries");
      continue;
    }
    const findings = parseKubescapeFindings(result.output || "{}");
    if (findings.length > 0) {
      return { findings: pickLatestFindings(findings) };
    }
  }

  const vulnerabilityCommands: Array<{ args: string[]; kind: string }> = [
    {
      args: ["get", "vulnerabilitymanifestsummaries", "-A", "-o", "json"],
      kind: "vulnerabilitymanifestsummaries",
    },
    {
      args: ["get", "vulnerabilitysummaries", "-A", "-o", "json"],
      kind: "vulnerabilitysummaries",
    },
  ];

  for (const { args, kind } of vulnerabilityCommands) {
    const result = await kubectlRawArgsFront(args, { clusterId });
    if (result.errors || result.code !== 0) {
      errors.push(result.errors || result.output || `Failed to query Kubescape ${kind}`);
      continue;
    }
    const findings = parseKubescapeVulnerabilityFindings(result.output || "{}", kind);
    if (findings.length > 0) {
      return { findings: pickLatestFindings(findings) };
    }
  }

  const allMissingType = errors.every((entry) => entry.includes("doesn't have a resource type"));
  if (allMissingType) {
    return { findings: [] };
  }

  return { findings: [], error: errors[0] || "Unable to load Kubescape findings" };
}

function computeSummary(
  runAt: string,
  providers: ComplianceProvider[],
  findings: ComplianceFinding[],
  errors: string[],
): ComplianceHubState["summary"] {
  const installedCount = providers.filter((provider) => provider.status === "installed").length;
  const hasFailures = findings.some((finding) => finding.severity !== "info");

  if (installedCount === 0) {
    return {
      status: "unavailable",
      lastRunAt: runAt,
      message: "Install Kubescape or kube-bench to start compliance scans",
    };
  }

  if (errors.length > 0) {
    return {
      status: "degraded",
      lastRunAt: runAt,
      message: errors[0],
    };
  }

  if (hasFailures) {
    return {
      status: "degraded",
      lastRunAt: runAt,
      message: `${findings.length} compliance finding${findings.length === 1 ? "" : "s"} loaded`,
    };
  }

  return {
    status: "ok",
    lastRunAt: runAt,
    message:
      findings.length > 0
        ? `${findings.length} compliance finding${findings.length === 1 ? "" : "s"} loaded`
        : "No compliance findings from configured providers",
  };
}

export async function runComplianceHubScan(
  clusterId: string,
  options?: { force?: boolean; statusOnly?: boolean },
): Promise<ComplianceHubState> {
  const config = get(complianceHubConfig);
  const currentState = get(complianceHubState)[clusterId];
  const statusOnly = Boolean(options?.statusOnly);

  if (currentState?.summary.lastRunAt && !options?.force) {
    const cachedUntil = new Date(currentState.summary.lastRunAt).getTime() + config.cacheTtlMs;
    if (Date.now() < cachedUntil) {
      return currentState;
    }
  }

  const runAt = new Date().toISOString();
  const [kubescape, kubeBench] = await Promise.all([
    getKubescapeRelease(clusterId),
    getKubeBenchRelease(clusterId),
  ]);

  const providers: ComplianceProvider[] = [
    buildProvider("kubescape", "Kubescape", kubescape.release, kubescape.error),
    buildProvider("kube-bench", "kube-bench", kubeBench.release, kubeBench.error),
  ];

  const errors: string[] = [];
  if (kubescape.error) errors.push(`Kubescape: ${kubescape.error}`);
  if (kubeBench.error) errors.push(`kube-bench: ${kubeBench.error}`);

  let findings: ComplianceFinding[] = currentState?.findings ?? [];
  if (!statusOnly) {
    findings = [];
  }

  if (!statusOnly && kubescape.installed) {
    const response = await fetchKubescapeFindings(clusterId);
    findings = response.findings;
    if (response.error) {
      errors.push(`Kubescape findings: ${response.error}`);
    }
  }

  const kubeBenchLatest = await fetchLatestKubeBenchJobMeta(clusterId);
  if (kubeBenchLatest.error) {
    errors.push(`kube-bench jobs: ${kubeBenchLatest.error}`);
  }
  if (kubeBenchLatest.job) {
    const kubeBenchProviderIndex = providers.findIndex((provider) => provider.id === "kube-bench");
    if (kubeBenchProviderIndex >= 0 && providers[kubeBenchProviderIndex]?.status !== "installed") {
      providers[kubeBenchProviderIndex] = {
        ...providers[kubeBenchProviderIndex],
        status: "installed",
        namespace: kubeBenchLatest.job.namespace,
        releaseName: "manual-job",
        message: `Manual job mode in ${kubeBenchLatest.job.namespace} namespace`,
      };
    }

    const kubeBenchFinding: ComplianceFinding = {
      id: `kube-bench-${kubeBenchLatest.job.name}`,
      provider: "kube-bench",
      severity: kubeBenchLatest.job.phase === "Failed" ? "high" : "info",
      framework: "CIS Kubernetes Benchmark",
      control: kubeBenchLatest.job.name,
      namespace: kubeBenchLatest.job.namespace,
      phase: kubeBenchLatest.job.phase,
      message: `succeeded ${kubeBenchLatest.job.succeeded ?? 0} · failed ${kubeBenchLatest.job.failed ?? 0} · active ${kubeBenchLatest.job.active ?? 0}`,
      updatedAt:
        kubeBenchLatest.job.completedAt ||
        kubeBenchLatest.job.startedAt ||
        kubeBenchLatest.job.createdAt ||
        runAt,
    };

    findings = findings.filter((finding) => finding.provider !== "kube-bench");
    findings.push(kubeBenchFinding);
  }

  const summary = computeSummary(runAt, providers, findings, errors);
  const nextState: ComplianceHubState = {
    summary,
    providers,
    findings,
    errors: errors.length > 0 ? errors : undefined,
  };

  complianceHubState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
  await updateClusterCheckPartially(clusterId, {
    complianceSummary: {
      status: nextState.summary.status,
      findingCount: nextState.findings.length,
      lastRunAt: nextState.summary.lastRunAt,
      message: nextState.summary.message,
    },
  });

  return nextState;
}

export async function installComplianceProvider(
  clusterId: string,
  providerId: ComplianceProviderId,
  onOutput?: (chunk: string) => void,
): Promise<{ success: boolean; error?: string }> {
  if (providerId === "kubescape") {
    return installKubescape(clusterId, undefined, onOutput);
  }
  return {
    success: false,
    error:
      "kube-bench Helm install is not supported from official aqua repo. Use Job/DaemonSet execution.",
  };
}

export async function runKubescapeScanNow(
  clusterId: string,
  namespace: string = "kubescape",
): Promise<{ success: boolean; error?: string; scanName?: string; namespace?: string }> {
  const safeClusterId = clusterKey(clusterId) || "cluster";
  const manifestRelPath = `${CONFIG_DIR}/kubescape-scan-${safeClusterId}.yaml`;
  const appLocalDataDirPath = await appDataDir();
  const manifestAbsPath = `${appLocalDataDirPath}/${manifestRelPath}`;
  const name = `dashboard-manual-${new Date().toISOString().replace(/[:.]/g, "-").toLowerCase()}`;

  const crd = await kubectlRawArgsFront(
    [
      "get",
      "crd",
      "workloadconfigurationscans.spdx.softwarecomposition.kubescape.io",
      "-o",
      "json",
    ],
    { clusterId },
  );
  if (crd.errors || crd.code !== 0) {
    return {
      success: false,
      error:
        "Kubescape operator is not installed or WorkloadConfigurationScan CRD is missing. " +
        "Install Kubescape operator first using the Install button.",
    };
  }

  let apiVersion = "spdx.softwarecomposition.kubescape.io/v1beta1";
  try {
    const parsed = JSON.parse(crd.output) as {
      spec?: {
        group?: string;
        versions?: Array<{ name?: string; served?: boolean; storage?: boolean }>;
      };
    };
    const group = parsed.spec?.group || "spdx.softwarecomposition.kubescape.io";
    const versions = parsed.spec?.versions ?? [];
    const selectedVersion =
      versions.find((version) => version.storage)?.name ||
      versions.find((version) => version.served)?.name ||
      versions[0]?.name;
    if (selectedVersion) {
      apiVersion = `${group}/${selectedVersion}`;
    }
  } catch {
    // Keep default apiVersion fallback.
  }

  const manifest = [
    `apiVersion: ${apiVersion}`,
    "kind: WorkloadConfigurationScan",
    "metadata:",
    `  name: ${name}`,
    `  namespace: ${namespace}`,
  ].join("\n");

  try {
    await writeTextFile(manifestRelPath, `${manifest}\n`, {
      baseDir: BaseDirectory.AppData,
    });

    const apply = await kubectlRawArgsFront(["apply", "-f", manifestAbsPath], { clusterId });
    if (apply.errors || apply.code !== 0) {
      return {
        success: false,
        error:
          apply.errors ||
          apply.output ||
          "Failed to trigger Kubescape scan (manifest apply failed).",
      };
    }
  } finally {
    await remove(manifestRelPath, { baseDir: BaseDirectory.AppData }).catch(() => {});
  }

  return { success: true, scanName: name, namespace };
}

export async function runKubeBenchScanNow(
  clusterId: string,
  namespace: string = "kube-system",
): Promise<{ success: boolean; error?: string; jobName?: string; namespace?: string }> {
  const safeClusterId = clusterKey(clusterId) || "cluster";
  const manifestRelPath = `${CONFIG_DIR}/kube-bench-job-${safeClusterId}.yaml`;
  const appLocalDataDirPath = await appDataDir();
  const manifestAbsPath = `${appLocalDataDirPath}/${manifestRelPath}`;
  const jobName = `dashboard-kube-bench-${Date.now()}`;

  const manifest = [
    "apiVersion: batch/v1",
    "kind: Job",
    "metadata:",
    `  name: ${jobName}`,
    `  namespace: ${namespace}`,
    "  labels:",
    "    app.kubernetes.io/name: kube-bench",
    "    app.kubernetes.io/managed-by: dashboard",
    "spec:",
    "  backoffLimit: 0",
    "  template:",
    "    spec:",
    "      restartPolicy: Never",
    "      hostPID: true",
    "      containers:",
    "      - name: kube-bench",
    "        image: aquasec/kube-bench:latest",
    "        args:",
    "        - run",
    "        - --targets=node",
    "        - --json",
  ].join("\n");

  try {
    await writeTextFile(manifestRelPath, `${manifest}\n`, {
      baseDir: BaseDirectory.AppData,
    });
    const apply = await kubectlRawArgsFront(["apply", "-f", manifestAbsPath], { clusterId });
    if (apply.errors || apply.code !== 0) {
      return {
        success: false,
        error: apply.errors || apply.output || "Failed to create kube-bench Job",
      };
    }
  } finally {
    await remove(manifestRelPath, { baseDir: BaseDirectory.AppData }).catch(() => {});
  }

  return { success: true, jobName, namespace };
}

export async function fetchLatestKubeBenchLogs(
  clusterId: string,
  namespace?: string,
): Promise<{
  success: boolean;
  error?: string;
  jobName?: string;
  namespace?: string;
  logs?: string;
  createdAt?: string;
}> {
  const latestMeta = await fetchLatestKubeBenchJobMeta(clusterId);
  if (latestMeta.error) {
    return {
      success: false,
      error: latestMeta.error,
    };
  }
  if (!latestMeta.job) {
    return { success: false, error: "No kube-bench jobs found yet." };
  }
  const jobName = latestMeta.job.name;
  const createdAt = latestMeta.job.createdAt;
  const logsNamespace = namespace || latestMeta.job.namespace;

  const logsResult = await kubectlRawArgsFront(["logs", `job/${jobName}`, "-n", logsNamespace], {
    clusterId,
  });
  if (logsResult.errors || logsResult.code !== 0) {
    return {
      success: false,
      error: logsResult.errors || logsResult.output || "Failed to read kube-bench logs",
      jobName,
      namespace: logsNamespace,
      createdAt,
    };
  }

  return {
    success: true,
    jobName,
    namespace: logsNamespace,
    createdAt,
    logs: logsResult.output || "",
  };
}

export function startComplianceHubPolling(clusterId: string) {
  if (!clusterId) return;

  const existing = pollControllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    ensureComplianceHubPolling(clusterId, existing);
    return;
  }

  const controller: PollController = { refCount: 1, timer: null };
  pollControllers.set(clusterId, controller);
  ensureComplianceHubPolling(clusterId, controller);
}

export function stopComplianceHubPolling(clusterId: string) {
  const controller = pollControllers.get(clusterId);
  if (!controller) return;
  controller.refCount -= 1;
  if (controller.refCount > 0) return;
  stopComplianceHubTimer(controller);
  pollControllers.delete(clusterId);
}

export function stopAllComplianceHubPolling() {
  for (const [clusterId, controller] of pollControllers.entries()) {
    stopComplianceHubTimer(controller);
    pollControllers.delete(clusterId);
  }
}

function stopComplianceHubTimer(controller: PollController) {
  if (!controller.timer) return;
  clearInterval(controller.timer);
  controller.timer = null;
}

function ensureComplianceHubPolling(clusterId: string, controller: PollController) {
  if (controller.timer || controller.refCount <= 0) return;
  if (!isClusterRuntimeHeavyDiagnosticsActive(clusterId)) return;
  if (!isDashboardFeatureRouteActive(clusterId, { workloads: ["compliancehub"] })) return;

  void runComplianceHubScan(clusterId, { force: true, statusOnly: true });
  const { scheduleMs } = get(complianceHubConfig);
  controller.timer = setInterval(() => {
    void runComplianceHubScan(clusterId, { force: true, statusOnly: true });
  }, scheduleMs);
}

function syncComplianceHubPolling(clusterId: string, controller: PollController) {
  if (
    isClusterRuntimeHeavyDiagnosticsActive(clusterId) &&
    isDashboardFeatureRouteActive(clusterId, { workloads: ["compliancehub"] })
  ) {
    ensureComplianceHubPolling(clusterId, controller);
    return;
  }
  stopComplianceHubTimer(controller);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncComplianceHubPolling(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncComplianceHubPolling(clusterId, controller);
  }
});

clusterRuntimeBudget.subscribe(() => {
  for (const [clusterId, controller] of pollControllers.entries()) {
    syncComplianceHubPolling(clusterId, controller);
  }
});

export function markComplianceHubUnavailable(clusterId: string, reason: string) {
  const nextState: ComplianceHubState = {
    summary: {
      ...DEFAULT_SUMMARY,
      message: reason,
      lastRunAt: null,
    },
    providers: [],
    findings: [],
    errors: [reason],
  };

  complianceHubState.update((state) => ({
    ...state,
    [clusterId]: nextState,
  }));
}
