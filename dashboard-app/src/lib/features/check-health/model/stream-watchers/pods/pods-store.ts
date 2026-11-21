import { createResourceStore } from "$shared/model/resource-store";
import type { PodItem } from "$shared/model/clusters";
import type { PodWatchEvent } from "./pods-parser";
import { eventBus } from "../event-bus";

const podStore = createResourceStore<Partial<PodItem>>({
  // Pod names repeat across namespaces; keyed by name alone, a watch event for
  // one namespace replaced or deleted the same-named pod of another.
  getId: (pod) => `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name || "unknownPod"}`,
});

eventBus.subscribe((event) => {
  if (event.kind !== "pod") return;

  podStore.apply(event.clusterId, event.payload as PodWatchEvent);
});

export const podsStore = podStore.store;
export const setInitialPods = podStore.setInitial;
