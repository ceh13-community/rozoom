import { createResourceStore } from "$shared/model/resource-store";
import type { StatefulSetItem } from "$shared/model/clusters";
import type { StatefulSetWatchEvent } from "./statefulsets-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

function getStatefulSetStoreId(item: Partial<StatefulSetItem>) {
  return `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "unknownStatefulSet"}`;
}

const statefulSetStore = createResourceStore<Partial<StatefulSetItem>>({
  getId: getStatefulSetStoreId,
});

function applyStatefulSetEventInternal(
  clusterId: string,
  event: StatefulSetWatchEvent,
  origin: "watch" | "optimistic",
) {
  statefulSetStore.apply(clusterId, event);
  if (origin === "watch") {
    acknowledgeMutationAck(
      clusterId,
      "statefulset",
      getStatefulSetStoreId(event.object),
      event.type,
    );
  }
}

eventBus.subscribe((event) => {
  if (event.kind !== "statefulset") return;
  applyStatefulSetEventInternal(event.clusterId, event.payload as StatefulSetWatchEvent, "watch");
});

export const statefulSetsStore = statefulSetStore.store;
export const setInitialStatefulSets = statefulSetStore.setInitial;
export function applyStatefulSetEvent(clusterId: string, event: StatefulSetWatchEvent) {
  applyStatefulSetEventInternal(clusterId, event, "optimistic");
}

export function selectClusterStatefulSets(clusterId: string): Readable<Partial<StatefulSetItem>[]> {
  return derived(statefulSetsStore, ($store) => $store[clusterId] ?? []);
}
