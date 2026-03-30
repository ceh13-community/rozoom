export type AutoscalerKind = "hpa" | "vpa" | "cluster-autoscaler" | "karpenter" | "keda";

export type AutoscalerStatus = {
  kind: AutoscalerKind;
  name: string;
  namespace: string;
  active: boolean;
  currentReplicas?: number;
  desiredReplicas?: number;
  minReplicas?: number;
  maxReplicas?: number;
  mode?: string;
  issues: string[];
};

export type AutoscalingPostureReport = {
  autoscalers: AutoscalerStatus[];
  summary: {
    total: number;
    active: number;
    inactive: number;
    withIssues: number;
    coverage: AutoscalingCoverage;
  };
  clusterAutoscaling: {
    detected: boolean;
    kind: AutoscalerKind | null;
  };
};

export type AutoscalingCoverage = {
  hpaCount: number;
  vpaCount: number;
  kedaCount: number;
  workloadsWithAutoscaling: number;
  totalWorkloads: number;
  coveragePercent: number;
};

type WorkloadInput = {
  name: string;
  namespace: string;
  kind: string;
};

type HpaInput = {
  name: string;
  namespace: string;
  targetRef?: { kind: string; name: string };
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  desiredReplicas?: number;
  active?: boolean;
  issues?: string[];
};

type VpaInput = {
  name: string;
  namespace: string;
  targetRef?: { kind: string; name: string };
  mode?: string;
};

type ScaledObjectInput = {
  name: string;
  namespace: string;
  targetRef?: { kind: string; name: string };
  minReplicas?: number;
  maxReplicas?: number;
  active?: boolean;
};

export function buildAutoscalingPosture(
  workloads: WorkloadInput[],
  hpas: HpaInput[],
  vpas: VpaInput[],
  scaledObjects: ScaledObjectInput[],
  clusterAutoscalerDetected: boolean,
  clusterAutoscalerKind: AutoscalerKind | null,
): AutoscalingPostureReport {
  const autoscalers: AutoscalerStatus[] = [];

  for (const hpa of hpas) {
    autoscalers.push({
      kind: "hpa",
      name: hpa.name,
      namespace: hpa.namespace,
      active: hpa.active ?? true,
      currentReplicas: hpa.currentReplicas,
      desiredReplicas: hpa.desiredReplicas,
      minReplicas: hpa.minReplicas,
      maxReplicas: hpa.maxReplicas,
      issues: hpa.issues ?? [],
    });
  }

  for (const vpa of vpas) {
    autoscalers.push({
      kind: "vpa",
      name: vpa.name,
      namespace: vpa.namespace,
      active: true,
      mode: vpa.mode,
      issues: [],
    });
  }

  for (const so of scaledObjects) {
    autoscalers.push({
      kind: "keda",
      name: so.name,
      namespace: so.namespace,
      active: so.active ?? true,
      minReplicas: so.minReplicas,
      maxReplicas: so.maxReplicas,
      issues: [],
    });
  }

  const scaledWorkloads = new Set<string>();
  for (const hpa of hpas) {
    if (hpa.targetRef) scaledWorkloads.add(`${hpa.namespace}/${hpa.targetRef.name}`);
  }
  for (const vpa of vpas) {
    if (vpa.targetRef) scaledWorkloads.add(`${vpa.namespace}/${vpa.targetRef.name}`);
  }
  for (const so of scaledObjects) {
    if (so.targetRef) scaledWorkloads.add(`${so.namespace}/${so.targetRef.name}`);
  }

  const totalWorkloads = workloads.length;
  const workloadsWithAutoscaling = workloads.filter((w) =>
    scaledWorkloads.has(`${w.namespace}/${w.name}`),
  ).length;

  const active = autoscalers.filter((a) => a.active).length;
  const withIssues = autoscalers.filter((a) => a.issues.length > 0).length;

  return {
    autoscalers,
    summary: {
      total: autoscalers.length,
      active,
      inactive: autoscalers.length - active,
      withIssues,
      coverage: {
        hpaCount: hpas.length,
        vpaCount: vpas.length,
        kedaCount: scaledObjects.length,
        workloadsWithAutoscaling,
        totalWorkloads,
        coveragePercent:
          totalWorkloads > 0 ? Math.round((workloadsWithAutoscaling / totalWorkloads) * 100) : 0,
      },
    },
    clusterAutoscaling: {
      detected: clusterAutoscalerDetected,
      kind: clusterAutoscalerKind,
    },
  };
}
