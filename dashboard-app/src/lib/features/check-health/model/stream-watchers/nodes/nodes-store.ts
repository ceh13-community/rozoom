import { createResourceStore } from "$shared/model/resource-store";
import type { NodeItem } from "$shared/model/clusters";
import type { NodeWatchEvent } from "./nodes-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { removeNodeAge, upsertNodesAge } from "../../nodes-age";

const nodeStore = createResourceStore<Partial<NodeItem>>({
  getId: (node) => node.metadata?.name || "unknownNode",

  // Node watch events should carry full object snapshots; prefer replacing sections to avoid stale fields.
  merge: (prev, next) => ({
    ...prev,
    metadata: (next.metadata ?? prev.metadata) as NodeItem["metadata"],
    spec: (next.spec ?? prev.spec) as NodeItem["spec"],
    status: (next.status ?? prev.status) as NodeItem["status"],
    ...next,
  }),
});

eventBus.subscribe((event) => {
  if (event.kind !== "node") return;

  const payload = event.payload as NodeWatchEvent;
  nodeStore.apply(event.clusterId, payload);

  const key = payload.object.metadata?.uid ?? payload.object.metadata?.name;
  if (!key) return;

  if (payload.type === "DELETED") {
    removeNodeAge(key);
    return;
  }

  upsertNodesAge([payload.object]);
});

export const nodesStore = nodeStore.store;
export const setInitialNodes = nodeStore.setInitial;

export function selectClusterNodes(clusterId: string): Readable<Partial<NodeItem>[]> {
  return derived(nodesStore, ($store) => $store[clusterId] ?? []);
}
