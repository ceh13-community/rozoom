import { derived, get, writable } from "svelte/store";
import { clusterHealthChecks } from "$features/check-health/model/cache-store";
import { clustersList } from "$features/cluster-manager";
import { computeFleetDrift } from "./compute-drift";
import type { ClusterDriftSnapshot, FleetDriftState } from "./types";

const EMPTY_BASELINE: FleetDriftState = {
  snapshots: {},
  fleetBaseline: {
    k8sVersion: "unknown",
    psaEnforcement: "unknown",
    resourceQuotas: "unknown",
    networkPolicyCoverage: "unknown",
    pdbCoverage: "unknown",
    imageFreshness: "unknown",
    ingressTls: "unknown",
    rbacOverprivileged: "unknown",
    storagePending: "unknown",
    serviceMesh: "unknown",
  },
  alignmentPercent: 100,
  totalClusters: 0,
  alignedClusters: 0,
  computedAt: 0,
};

const fleetDriftStore = writable<FleetDriftState>(EMPTY_BASELINE);

let autoRecomputeUnsub: (() => void) | null = null;

export function startAutoRecompute() {
  stopAutoRecompute();
  autoRecomputeUnsub = clusterHealthChecks.subscribe(() => {
    recomputeFleetDrift();
  });
}

export function stopAutoRecompute() {
  if (autoRecomputeUnsub) {
    autoRecomputeUnsub();
    autoRecomputeUnsub = null;
  }
}

export const fleetDrift = {
  subscribe: fleetDriftStore.subscribe,
};

const clusterDriftSelectors = new Map<
  string,
  ReturnType<typeof derived<typeof fleetDriftStore, ClusterDriftSnapshot | null>>
>();

export function selectClusterDrift(clusterId: string) {
  let selector = clusterDriftSelectors.get(clusterId);
  if (!selector) {
    selector = derived(fleetDriftStore, ($state) => $state.snapshots[clusterId] ?? null);
    clusterDriftSelectors.set(clusterId, selector);
  }
  return selector;
}

export function recomputeFleetDrift() {
  const clusters = get(clustersList);
  const healthChecks = get(clusterHealthChecks);

  const inputs = clusters
    .filter((c) => c.uuid && !c.offline)
    .map((c) => {
      const checks = healthChecks[c.uuid];
      if (!checks || "errors" in checks) return null;
      return {
        clusterId: c.uuid,
        clusterName: c.name || c.uuid,
        checks,
      };
    })
    .filter((input): input is NonNullable<typeof input> => input !== null);

  const state = computeFleetDrift(inputs);
  fleetDriftStore.set(state);
  return state;
}

export function getFleetDriftSnapshot(): FleetDriftState {
  return get(fleetDriftStore);
}

export function getClusterDriftSnapshot(clusterId: string): ClusterDriftSnapshot | null {
  return get(fleetDriftStore).snapshots[clusterId] ?? null;
}
