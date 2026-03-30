import type { ReplicaSetItem } from "$shared/model/clusters";
import { initWatchParsers } from "../register-parsers";
import { setInitialReplicaSets } from "./replicasets-store";
import { startReplicaSetsWatcher, stopReplicaSetsWatcher } from "./replicasets-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const replicaSetsApiSync = createApiResourceSync<Partial<ReplicaSetItem>>({
  getPath: () => "/apis/apps/v1/replicasets",
  kind: "replicaset",
  setInitial: setInitialReplicaSets,
  fallbackStart: startReplicaSetsWatcher,
  fallbackStop: stopReplicaSetsWatcher,
});

export function initReplicaSetsSync(clusterId: string, initialItems?: Partial<ReplicaSetItem>[]) {
  initWatchParsers();
  if (initialItems?.length) {
    setInitialReplicaSets(clusterId, initialItems);
  }
  replicaSetsApiSync.start(clusterId);
}

export function destroyReplicaSetsSync(clusterId: string) {
  replicaSetsApiSync.stop(clusterId);
}
