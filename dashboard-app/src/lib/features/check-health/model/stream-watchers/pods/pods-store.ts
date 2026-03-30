import { createResourceStore } from "$shared/model/resource-store";
import type { PodItem } from "$shared/model/clusters";
import type { PodWatchEvent } from "./pods-parser";
import { eventBus } from "../event-bus";

const podStore = createResourceStore<Partial<PodItem>>({
  getId: (pod) => pod.metadata?.name || "unknownPod",
});

eventBus.subscribe((event) => {
  if (event.kind !== "pod") return;

  podStore.apply(event.clusterId, event.payload as PodWatchEvent);
});

export const podsStore = podStore.store;
export const setInitialPods = podStore.setInitial;
