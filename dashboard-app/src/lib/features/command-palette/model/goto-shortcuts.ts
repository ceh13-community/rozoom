import type { WorkloadType } from "$shared/model/workloads";

/**
 * Vim-style "g + key" chord mappings for quick workload navigation.
 * Press "g" then the second key within the chord timeout.
 */
export const GOTO_CHORD_MAP: Record<string, WorkloadType> = {
  d: "deployments",
  p: "pods",
  s: "statefulsets",
  a: "daemonsets",
  r: "replicasets",
  j: "jobs",
  c: "configmaps",
  n: "nodesstatus",
  i: "ingresses",
  e: "services",
  o: "overview",
  h: "helm",
  k: "cronjobs",
  v: "persistentvolumeclaims",
};

export function getGotoChords(): Array<{ chord: string; workload: WorkloadType; label: string }> {
  const labels: Record<string, string> = {
    d: "Deployments",
    p: "Pods",
    s: "StatefulSets",
    a: "DaemonSets",
    r: "ReplicaSets",
    j: "Jobs",
    c: "ConfigMaps",
    n: "Nodes",
    i: "Ingresses",
    e: "Services",
    o: "Overview",
    h: "Helm",
    k: "CronJobs",
    v: "PVCs",
  };

  return Object.entries(GOTO_CHORD_MAP).map(([key, workload]) => ({
    chord: `g ${key}`,
    workload,
    label: labels[key] ?? workload,
  }));
}
