import type { PodItem } from "$shared/model/clusters";
import { setInitialPods } from "./pods-store";
import { startPodsWatcher, stopPodsWatcher } from "./pods-watcher";
import { initWatchParsers } from "../register-parsers";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const podsApiSync = createApiResourceSync<Partial<PodItem>>({
  getPath: () => "/api/v1/pods",
  kind: "pod",
  setInitial: setInitialPods,
  fallbackStart: startPodsWatcher,
  fallbackStop: stopPodsWatcher,
});

export function initPodsSync(clusterId: string, initialPods?: Partial<PodItem>[]) {
  initWatchParsers();
  if (initialPods) {
    setInitialPods(clusterId, initialPods);
  }

  podsApiSync.start(clusterId);
}

export function destroyPodsSync(clusterId: string) {
  podsApiSync.stop(clusterId);
}
