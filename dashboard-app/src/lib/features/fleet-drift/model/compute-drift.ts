import type { ClusterHealthChecks } from "$features/check-health/model/types";
import type {
  ClusterDriftSnapshot,
  DimensionSeverity,
  DriftDimension,
  DriftItem,
  DriftSeverity,
  FleetDriftState,
} from "./types";

type ClusterInput = {
  clusterId: string;
  clusterName: string;
  checks: ClusterHealthChecks;
};

function ext(checks: Record<string, unknown>, key: string): unknown {
  return checks[key];
}

function extractDimensionValue(checks: ClusterHealthChecks, dimension: DriftDimension): string {
  const rc = checks as Record<string, unknown>;
  switch (dimension) {
    case "k8sVersion": {
      if (!checks.apiServerHealth) return "unknown";
      return "detected";
    }
    case "psaEnforcement": {
      if (!checks.podSecurity) return "unknown";
      return checks.podSecurity.status;
    }
    case "resourceQuotas": {
      const rq = ext(rc, "resourceQuotas") as { summary?: { total?: number } } | undefined;
      if (!rq?.summary) return "none";
      return rq.summary.total ? "present" : "none";
    }
    case "networkPolicyCoverage": {
      if (!checks.networkIsolation) return "unknown";
      return checks.networkIsolation.status;
    }
    case "pdbCoverage": {
      if (!checks.pdbStatus) return "unknown";
      return checks.pdbStatus.status;
    }
    case "imageFreshness": {
      const img = ext(rc, "imageFreshness") as { status?: string } | undefined;
      if (!img) return "unknown";
      return img.status ?? "unknown";
    }
    case "ingressTls": {
      const ing = ext(rc, "ingressStatus") as
        | { summary?: { total?: number; withoutTls?: number } }
        | undefined;
      if (!ing?.summary || !ing.summary.total) return "unknown";
      return ing.summary.withoutTls ? "partial" : "full";
    }
    case "rbacOverprivileged": {
      const rbac = ext(rc, "rbacOverview") as
        | { summary?: { overprivilegedCount?: number } }
        | undefined;
      if (!rbac?.summary) return "unknown";
      return (rbac.summary.overprivilegedCount ?? 0) > 0 ? "overprivileged" : "clean";
    }
    case "storagePending": {
      const stor = ext(rc, "storageStatus") as
        | { summary?: { pendingPVCs?: number; lostPVCs?: number } }
        | undefined;
      if (!stor?.summary) return "unknown";
      if ((stor.summary.lostPVCs ?? 0) > 0) return "lost";
      if ((stor.summary.pendingPVCs ?? 0) > 0) return "pending";
      return "healthy";
    }
    case "serviceMesh": {
      const mesh = ext(rc, "serviceMesh") as { detected?: boolean; meshType?: string } | undefined;
      if (!mesh) return "unknown";
      return mesh.detected ? (mesh.meshType ?? "detected") : "none";
    }
  }
}

function computeFleetMajority(clusters: ClusterInput[], dimension: DriftDimension): string {
  const counts = new Map<string, number>();

  for (const c of clusters) {
    const value = extractDimensionValue(c.checks, dimension);
    if (value === "unknown") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (counts.size === 0) return "unknown";

  let maxCount = 0;
  let majority = "unknown";
  for (const [value, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      majority = value;
    }
  }
  return majority;
}

const DIMENSION_LABELS: Record<DriftDimension, string> = {
  k8sVersion: "K8s Version",
  psaEnforcement: "Pod Security",
  resourceQuotas: "Resource Quotas",
  networkPolicyCoverage: "Network Policies",
  pdbCoverage: "PDB Coverage",
  imageFreshness: "Image Hygiene",
  ingressTls: "Ingress TLS",
  rbacOverprivileged: "RBAC Privileges",
  storagePending: "Storage Health",
  serviceMesh: "Service Mesh",
};

const DIMENSION_SEVERITY: Record<DriftDimension, DimensionSeverity> = {
  k8sVersion: "critical",
  psaEnforcement: "critical",
  networkPolicyCoverage: "high",
  pdbCoverage: "high",
  rbacOverprivileged: "high",
  ingressTls: "medium",
  storagePending: "medium",
  imageFreshness: "medium",
  resourceQuotas: "info",
  serviceMesh: "info",
};

const ALL_DIMENSIONS: DriftDimension[] = [
  "k8sVersion",
  "psaEnforcement",
  "networkPolicyCoverage",
  "pdbCoverage",
  "rbacOverprivileged",
  "ingressTls",
  "storagePending",
  "imageFreshness",
  "resourceQuotas",
  "serviceMesh",
];

function computeSeverity(drifts: DriftItem[]): DriftSeverity {
  const drifted = drifts.filter((d) => d.isDrifted);
  if (drifted.length === 0) return "ok";
  if (drifted.some((d) => d.dimensionSeverity === "critical")) return "critical";
  if (drifted.length >= 3 || drifted.some((d) => d.dimensionSeverity === "high")) return "critical";
  return "warning";
}

export function computeFleetDrift(clusters: ClusterInput[]): FleetDriftState {
  const emptyBaseline = Object.fromEntries(ALL_DIMENSIONS.map((d) => [d, "unknown"])) as Record<
    DriftDimension,
    string
  >;

  if (clusters.length === 0) {
    return {
      snapshots: {},
      fleetBaseline: emptyBaseline,
      alignmentPercent: 100,
      totalClusters: 0,
      alignedClusters: 0,
      computedAt: Date.now(),
    };
  }

  const fleetBaseline = Object.fromEntries(
    ALL_DIMENSIONS.map((dimension) => [dimension, computeFleetMajority(clusters, dimension)]),
  ) as Record<DriftDimension, string>;

  const snapshots: Record<string, ClusterDriftSnapshot> = {};

  for (const cluster of clusters) {
    const drifts: DriftItem[] = [];

    for (const dimension of ALL_DIMENSIONS) {
      const clusterValue = extractDimensionValue(cluster.checks, dimension);
      const majority = fleetBaseline[dimension];
      const isDrifted =
        clusterValue !== "unknown" && majority !== "unknown" && clusterValue !== majority;

      drifts.push({
        dimension,
        label: DIMENSION_LABELS[dimension],
        clusterValue,
        fleetMajority: majority,
        isDrifted,
        dimensionSeverity: DIMENSION_SEVERITY[dimension],
      });
    }

    const driftCount = drifts.filter((d) => d.isDrifted).length;

    snapshots[cluster.clusterId] = {
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      drifts,
      driftCount,
      severity: computeSeverity(drifts),
      computedAt: Date.now(),
    };
  }

  const snapshotValues = Object.values(snapshots);
  const alignedClusters = snapshotValues.filter((s) => s.driftCount === 0).length;
  const alignmentPercent =
    clusters.length > 0 ? Math.round((alignedClusters / clusters.length) * 100) : 100;

  return {
    snapshots,
    fleetBaseline,
    alignmentPercent,
    totalClusters: clusters.length,
    alignedClusters,
    computedAt: Date.now(),
  };
}
