export type DriftDimension =
  | "k8sVersion"
  | "psaEnforcement"
  | "resourceQuotas"
  | "networkPolicyCoverage"
  | "pdbCoverage"
  | "imageFreshness"
  | "ingressTls"
  | "rbacOverprivileged"
  | "storagePending"
  | "serviceMesh";

export type DriftSeverity = "ok" | "warning" | "critical";

export type DimensionSeverity = "critical" | "high" | "medium" | "info";

export type DriftItem = {
  dimension: DriftDimension;
  label: string;
  clusterValue: string;
  fleetMajority: string;
  isDrifted: boolean;
  dimensionSeverity: DimensionSeverity;
};

export type ClusterDriftSnapshot = {
  clusterId: string;
  clusterName: string;
  drifts: DriftItem[];
  driftCount: number;
  severity: DriftSeverity;
  computedAt: number;
};

export type FleetDriftState = {
  snapshots: Record<string, ClusterDriftSnapshot>;
  fleetBaseline: Record<DriftDimension, string>;
  alignmentPercent: number;
  totalClusters: number;
  alignedClusters: number;
  computedAt: number;
};
