import type { StatefulSetItem } from "$shared/model/clusters";
import { initWatchParsers } from "../register-parsers";
import { setInitialStatefulSets } from "./statefulsets-store";
import { startStatefulSetsWatcher, stopStatefulSetsWatcher } from "./statefulsets-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const statefulSetsApiSync = createApiResourceSync<Partial<StatefulSetItem>>({
  getPath: () => "/apis/apps/v1/statefulsets",
  kind: "statefulset",
  setInitial: setInitialStatefulSets,
  fallbackStart: startStatefulSetsWatcher,
  fallbackStop: stopStatefulSetsWatcher,
});

export function initStatefulSetsSync(clusterId: string, initialItems?: Partial<StatefulSetItem>[]) {
  initWatchParsers();
  if (initialItems?.length) {
    setInitialStatefulSets(clusterId, initialItems);
  }
  statefulSetsApiSync.start(clusterId);
}

export function destroyStatefulSetsSync(clusterId: string) {
  statefulSetsApiSync.stop(clusterId);
}
