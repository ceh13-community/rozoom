import type { ContainerStatusState } from "$shared/model/clusters";
import type { CheckMetricResult, ClusterHealthChecks } from "../model/types";

interface PodData {
  containerName: string;
  namespace: string;
  lastState?: ContainerStatusState;
  ready: boolean;
  restartCount: number;
  startedAt?: string;
  state: ContainerStatusState;
}

function getPodContainerState(pod: PodData) {
  return (pod.state as ContainerStatusState | undefined) ?? undefined;
}

export const sortedMetricsEndpoints = (endpoints: { [key: string]: CheckMetricResult }) => {
  const keys = Object.keys(endpoints);
  keys.sort();

  const sorted: { [key: string]: CheckMetricResult } = {};
  keys.forEach((key) => {
    sorted[key] = endpoints[key];
  });

  return sorted;
};

export const getContainerReason = (pod: PodData) => {
  const state = getPodContainerState(pod);
  if (state?.terminated) {
    return state.terminated.reason;
  }

  if (state?.waiting) {
    return state.waiting.reason;
  }

  return "-";
};

export const getContainerStatus = (pod: PodData) => {
  const state = getPodContainerState(pod);
  if (state?.waiting && state.waiting.reason === "CrashLoopBackOff") {
    return "⚠️Critical";
  }

  if (state?.terminated) {
    return "❌Terminated";
  }

  if (pod.restartCount > 0) {
    return "🔃Restarted";
  }

  if (state?.running) {
    return "🏃Running";
  }

  return "-";
};

export function countPressuresByNodeStatus(checks: ClusterHealthChecks | null): number {
  if (!checks?.nodes?.summary.count.pressures) return 0;

  return Object.values(checks.nodes.summary.count.pressures).reduce(
    (sum, pressure) => sum + pressure,
    0,
  );
}
