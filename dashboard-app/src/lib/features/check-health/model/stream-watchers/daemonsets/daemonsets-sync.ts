import type { DaemonSetItem } from "$shared/model/clusters";
import { initWatchParsers } from "../register-parsers";
import { setInitialDaemonSets } from "./daemonsets-store";
import { startDaemonSetsWatcher, stopDaemonSetsWatcher } from "./daemonsets-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const daemonSetsApiSync = createApiResourceSync<Partial<DaemonSetItem>>({
  getPath: () => "/apis/apps/v1/daemonsets",
  kind: "daemonset",
  setInitial: setInitialDaemonSets,
  fallbackStart: startDaemonSetsWatcher,
  fallbackStop: stopDaemonSetsWatcher,
});

export function initDaemonSetsSync(clusterId: string, initialItems?: Partial<DaemonSetItem>[]) {
  initWatchParsers();
  if (initialItems?.length) {
    setInitialDaemonSets(clusterId, initialItems);
  }
  daemonSetsApiSync.start(clusterId);
}

export function destroyDaemonSetsSync(clusterId: string) {
  daemonSetsApiSync.stop(clusterId);
}
