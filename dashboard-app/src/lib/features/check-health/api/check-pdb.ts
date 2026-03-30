import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, PodItem, PodDisruptionBudgetItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  PdbHealthItem,
  PdbHealthReport,
  PdbHealthStatus,
  PdbHealthSummary,
  PdbMode,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: PdbHealthReport; fetchedAt: number }>();

const CRITICAL_LABEL_KEYS = [
  "kubemaster.io/critical",
  "kubemaster.io/production",
  "app.kubernetes.io/critical",
  "app.kubernetes.io/production",
];

type WorkloadDescriptor = {
  namespace: string;
  name: string;
  type: "Deployment" | "StatefulSet";
  replicas: number;
  selector: Record<string, string>;
  labels?: Record<string, string>;
};

type PdbDescriptor = {
  namespace: string;
  name: string;
  selector: Record<string, string> | undefined;
  minAvailable?: number | string;
  maxUnavailable?: number | string;
  disruptionsAllowed?: number;
};

type ResolvedValue = {
  raw?: string;
  count: number | null;
  isPercent: boolean;
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): PdbHealthStatus {
  if (!message) return "unknown";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return "insufficient";
  }
  if (
    normalized.includes("connection") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable") ||
    normalized.includes("refused")
  ) {
    return "unreachable";
  }
  return "unknown";
}

function matchLabels(
  labels: Record<string, string> | undefined,
  selector?: Record<string, string>,
) {
  if (!labels || !selector || Object.keys(selector).length === 0) return false;
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function hasCriticalLabel(labels: Record<string, string> | undefined): boolean {
  if (!labels) return false;
  return CRITICAL_LABEL_KEYS.some((key) => {
    const value = labels[key];
    return value ? value.toLowerCase() === "true" : false;
  });
}

function extractWorkloads(data: ClusterData): WorkloadDescriptor[] {
  const workloads: WorkloadDescriptor[] = [];

  data.deployments.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "Deployment",
      replicas: item.spec.replicas,
      selector: item.spec.selector.matchLabels,
      labels: item.metadata.labels,
    });
  });

  data.statefulsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "StatefulSet",
      replicas: item.spec.replicas,
      selector: item.spec.selector.matchLabels,
      labels: item.metadata.labels,
    });
  });

  return workloads;
}

function resolveMode(pdb: PdbDescriptor): { mode: PdbMode; value?: number | string } {
  if (pdb.minAvailable !== undefined) return { mode: "minAvailable", value: pdb.minAvailable };
  if (pdb.maxUnavailable !== undefined)
    return { mode: "maxUnavailable", value: pdb.maxUnavailable };
  return { mode: "unknown" };
}

function formatValue(value?: number | string): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}` : value;
}

function resolveIntOrPercent(value: number | string | undefined, replicas: number): ResolvedValue {
  if (value === undefined) return { count: null, isPercent: false };
  if (typeof value === "number") {
    return { count: value, isPercent: false, raw: `${value}` };
  }
  const raw = value;
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.replace("%", ""));
    if (Number.isNaN(percent)) return { count: null, isPercent: true, raw };
    const count = Math.ceil((percent / 100) * replicas);
    return { count, isPercent: true, raw };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return { count: null, isPercent: false, raw };
  return { count: parsed, isPercent: false, raw };
}

function buildSummary(items: PdbHealthItem[], errorStatus?: PdbHealthStatus): PdbHealthSummary {
  const totals = items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ok") acc.ok += 1;
      if (item.status === "warning") acc.warning += 1;
      if (item.status === "critical") acc.critical += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 },
  );

  let status: PdbHealthStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = `Warning (${totals.warning})`;
  } else if (status === "critical") {
    message = `Critical (${totals.critical})`;
  } else if (status === "unreachable") {
    message = "Unreachable";
  } else if (status === "insufficient") {
    message = "Insufficient permissions";
  } else if (status === "unknown") {
    message = "Unknown";
  }

  return { status, message, ...totals, updatedAt: Date.now() };
}

function buildRecommendations(workload: WorkloadDescriptor): string[] {
  if (workload.replicas < 2) return [];

  if (workload.type === "StatefulSet") {
    return [
      "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: my-app-pdb\nspec:\n  maxUnavailable: 1\n  selector:\n    matchLabels:\n      app: my-app",
    ];
  }

  if (workload.replicas >= 3) {
    return [
      "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: my-app-pdb\nspec:\n  minAvailable: 2\n  selector:\n    matchLabels:\n      app: my-app",
    ];
  }

  return [
    "apiVersion: policy/v1\nkind: PodDisruptionBudget\nmetadata:\n  name: my-app-pdb\nspec:\n  maxUnavailable: 1\n  selector:\n    matchLabels:\n      app: my-app",
  ];
}

function evaluateWorkload(
  workload: WorkloadDescriptor,
  pods: PodItem[],
  pdbs: PdbDescriptor[],
): PdbHealthItem {
  const issues: string[] = [];
  let recommendations: string[] = [];
  let hasCriticalIssue = false;

  const matchingPods = pods.filter(
    (pod) =>
      normalizeNamespace(pod.metadata.namespace) === workload.namespace &&
      matchLabels(pod.metadata.labels, workload.selector),
  );

  const isCriticalWorkload =
    workload.replicas >= 2 &&
    (workload.type === "StatefulSet" || hasCriticalLabel(workload.labels));

  if (workload.replicas < 2 && pdbs.length > 0) {
    issues.push("PDB configured for a single-replica workload; drains may be blocked.");
    hasCriticalIssue = true;
  }

  if (workload.replicas >= 2 && isCriticalWorkload && pdbs.length === 0) {
    issues.push("Missing PDB for a critical or stateful workload.");
    hasCriticalIssue = true;
  }

  if (pdbs.length > 1) {
    issues.push("Multiple PDBs target the same workload.");
  }

  const pdb = pdbs.length > 0 ? pdbs[0] : undefined;
  const modeInfo = pdb ? resolveMode(pdb) : { mode: "unknown" as PdbMode };

  if (pdb) {
    if (!pdb.selector || Object.keys(pdb.selector).length === 0) {
      issues.push("PDB selector is empty; it will not match pods.");
    } else if (matchingPods.length > 0) {
      const matchesPods = matchingPods.some((pod) =>
        matchLabels(pod.metadata.labels, pdb.selector),
      );
      if (!matchesPods) {
        issues.push("PDB selector does not match workload pods.");
      }
    } else {
      issues.push("No pods match the PDB selector.");
    }

    if (pdb.minAvailable !== undefined && pdb.maxUnavailable !== undefined) {
      issues.push("PDB defines both minAvailable and maxUnavailable.");
    }

    if (pdb.disruptionsAllowed === 0 && workload.replicas >= 2) {
      issues.push("PDB currently allows zero disruptions.");
      if (isCriticalWorkload) {
        hasCriticalIssue = true;
      }
    }

    if (modeInfo.mode === "minAvailable") {
      const resolved = resolveIntOrPercent(pdb.minAvailable, workload.replicas);
      if (resolved.count !== null && resolved.count >= workload.replicas) {
        issues.push("minAvailable equals or exceeds replicas; drains will be blocked.");
        hasCriticalIssue = true;
      } else if (resolved.count !== null && resolved.count <= 0) {
        issues.push("minAvailable is zero; PDB provides no protection.");
      }
    }

    if (modeInfo.mode === "maxUnavailable") {
      const resolved = resolveIntOrPercent(pdb.maxUnavailable, workload.replicas);
      if (resolved.count !== null && resolved.count === 0) {
        issues.push("maxUnavailable is zero; voluntary disruptions are blocked.");
        if (workload.replicas <= 1) {
          hasCriticalIssue = true;
        }
      } else if (resolved.count !== null && resolved.count >= workload.replicas) {
        issues.push("maxUnavailable allows evicting all replicas.");
      }
    }
  }

  let status: PdbHealthStatus = "ok";
  if (hasCriticalIssue) {
    status = "critical";
  } else if (issues.length > 0) {
    status = "warning";
  }

  if (issues.length > 0 && workload.replicas >= 2) {
    recommendations = buildRecommendations(workload);
  }

  return {
    namespace: workload.namespace,
    workload: workload.name,
    workloadType: workload.type,
    replicas: workload.replicas,
    pdbName: pdb?.name,
    mode: modeInfo.mode,
    modeValue: pdb ? formatValue(modeInfo.value) : undefined,
    disruptionsAllowed: pdb?.disruptionsAllowed,
    status,
    issues,
    recommendations,
  };
}

function buildPdbDescriptors(items: PodDisruptionBudgetItem[]): PdbDescriptor[] {
  return items.map((item) => ({
    namespace: normalizeNamespace(item.metadata.namespace),
    name: item.metadata.name,
    selector: item.spec.selector?.matchLabels,
    minAvailable: item.spec.minAvailable,
    maxUnavailable: item.spec.maxUnavailable,
    disruptionsAllowed: item.status?.disruptionsAllowed,
  }));
}

function buildUnmatchedItems(
  pdbs: PdbDescriptor[],
  workloads: WorkloadDescriptor[],
): PdbHealthItem[] {
  const matchedNames = new Set<string>();
  workloads.forEach((workload) => {
    pdbs.forEach((pdb) => {
      if (pdb.namespace === workload.namespace && matchLabels(workload.selector, pdb.selector)) {
        matchedNames.add(`${pdb.namespace}/${pdb.name}`);
      }
    });
  });

  return pdbs
    .filter((pdb) => !matchedNames.has(`${pdb.namespace}/${pdb.name}`))
    .map((pdb) => {
      const issues = [
        pdb.selector
          ? "PDB selector does not match any workload selector."
          : "PDB has no selector configured.",
      ];
      const modeInfo = resolveMode(pdb);
      return {
        namespace: pdb.namespace,
        workload: pdb.name,
        workloadType: "PDB",
        replicas: 0,
        pdbName: pdb.name,
        mode: modeInfo.mode,
        modeValue: formatValue(modeInfo.value),
        disruptionsAllowed: pdb.disruptionsAllowed,
        status: "warning",
        issues,
        recommendations: [],
      };
    });
}

export async function checkPdbStatus(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<PdbHealthReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let data: ClusterData | null = null;

  try {
    data =
      options?.data ??
      (await loadClusterEntities({ uuid: clusterId }, [
        "pods",
        "deployments",
        "statefulsets",
        "poddisruptionbudgets",
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load workload data.";
      await logError(`PDB check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load workload data.";
    await logError(`PDB check failed: ${errorMessage}`);
    data = null;
  }

  const items: PdbHealthItem[] = [];

  if (data) {
    const workloads = extractWorkloads(data);
    const pdbs = buildPdbDescriptors(data.poddisruptionbudgets.items);

    workloads.forEach((workload) => {
      const matched = pdbs.filter(
        (pdb) =>
          pdb.namespace === workload.namespace && matchLabels(workload.selector, pdb.selector),
      );
      items.push(evaluateWorkload(workload, data.pods.items, matched));
    });

    items.push(...buildUnmatchedItems(pdbs, workloads));
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus);

  const report: PdbHealthReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
