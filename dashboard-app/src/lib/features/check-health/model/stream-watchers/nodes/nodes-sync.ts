import type { NodeItem } from "$shared/model/clusters";
import { setInitialNodes } from "./nodes-store";
import { startNodesWatcher, stopNodesWatcher } from "./nodes-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const nodesApiSync = createApiResourceSync<Partial<NodeItem>>({
  getPath: () => "/api/v1/nodes",
  kind: "node",
  setInitial: setInitialNodes,
  fallbackStart: startNodesWatcher,
  fallbackStop: stopNodesWatcher,
});

export function initNodesSync(clusterId: string, initialNodes?: Partial<NodeItem>[]) {
  if (initialNodes && initialNodes.length) {
    setInitialNodes(clusterId, initialNodes);
  }

  nodesApiSync.start(clusterId);
}

export function destroyNodesSync(clusterId: string) {
  nodesApiSync.stop(clusterId);
}
