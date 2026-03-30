import { createResourceStore } from "$shared/model/resource-store";
import type { DaemonSetItem } from "$shared/model/clusters";
import type { DaemonSetWatchEvent } from "./daemonsets-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

function getDaemonSetStoreId(item: Partial<DaemonSetItem>) {
  return `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "unknownDaemonSet"}`;
}

const daemonSetStore = createResourceStore<Partial<DaemonSetItem>>({
  getId: getDaemonSetStoreId,
});

function applyDaemonSetEventInternal(
  clusterId: string,
  event: DaemonSetWatchEvent,
  origin: "watch" | "optimistic",
) {
  daemonSetStore.apply(clusterId, event);
  if (origin === "watch") {
    acknowledgeMutationAck(clusterId, "daemonset", getDaemonSetStoreId(event.object), event.type);
  }
}

eventBus.subscribe((event) => {
  if (event.kind !== "daemonset") return;
  applyDaemonSetEventInternal(event.clusterId, event.payload as DaemonSetWatchEvent, "watch");
});

export const daemonSetsStore = daemonSetStore.store;
export const setInitialDaemonSets = daemonSetStore.setInitial;
export function applyDaemonSetEvent(clusterId: string, event: DaemonSetWatchEvent) {
  applyDaemonSetEventInternal(clusterId, event, "optimistic");
}

export function selectClusterDaemonSets(clusterId: string): Readable<Partial<DaemonSetItem>[]> {
  return derived(daemonSetsStore, ($store) => $store[clusterId] ?? []);
}
