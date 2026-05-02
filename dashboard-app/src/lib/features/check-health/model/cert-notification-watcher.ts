import { get } from "svelte/store";
import { clusterHealthChecks } from "./cache-store";
import { clustersList } from "$features/cluster-manager";
import { emitCertNotifications } from "./cert-notification-emitter";
import type { ClusterHealthChecks } from "./types";

let unsubscribe: (() => void) | null = null;

function getClusterName(clusterId: string): string {
  const clusters = get(clustersList);
  const cluster = clusters.find((c) => c.uuid === clusterId);
  return cluster?.name ?? cluster?.displayName ?? clusterId;
}

function isHealthChecks(check: unknown): check is ClusterHealthChecks {
  return check !== null && typeof check === "object" && !("errors" in check);
}

export function startCertNotificationWatcher() {
  if (unsubscribe) return;

  unsubscribe = clusterHealthChecks.subscribe((checks) => {
    for (const [clusterId, check] of Object.entries(checks)) {
      if (!isHealthChecks(check)) continue;
      if (!check.certificatesHealth) continue;
      emitCertNotifications(clusterId, getClusterName(clusterId), check.certificatesHealth);
    }
  });
}

export function stopCertNotificationWatcher() {
  unsubscribe?.();
  unsubscribe = null;
}
