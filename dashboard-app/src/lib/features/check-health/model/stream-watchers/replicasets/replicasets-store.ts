import { createResourceStore } from "$shared/model/resource-store";
import type { ReplicaSetItem } from "$shared/model/clusters";
import type { ReplicaSetWatchEvent } from "./replicasets-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

function getReplicaSetStoreId(item: Partial<ReplicaSetItem>) {
  return `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "unknownReplicaSet"}`;
}

const replicaSetStore = createResourceStore<Partial<ReplicaSetItem>>({
  getId: getReplicaSetStoreId,
});

function applyReplicaSetEventInternal(
  clusterId: string,
  event: ReplicaSetWatchEvent,
  origin: "watch" | "optimistic",
) {
  replicaSetStore.apply(clusterId, event);
  if (origin === "watch") {
    acknowledgeMutationAck(clusterId, "replicaset", getReplicaSetStoreId(event.object), event.type);
  }
}

eventBus.subscribe((event) => {
  if (event.kind !== "replicaset") return;
  applyReplicaSetEventInternal(event.clusterId, event.payload as ReplicaSetWatchEvent, "watch");
});

export const replicaSetsStore = replicaSetStore.store;
export const setInitialReplicaSets = replicaSetStore.setInitial;
export function applyReplicaSetEvent(clusterId: string, event: ReplicaSetWatchEvent) {
  applyReplicaSetEventInternal(clusterId, event, "optimistic");
}

export function selectClusterReplicaSets(clusterId: string): Readable<Partial<ReplicaSetItem>[]> {
  return derived(replicaSetsStore, ($store) => $store[clusterId] ?? []);
}
