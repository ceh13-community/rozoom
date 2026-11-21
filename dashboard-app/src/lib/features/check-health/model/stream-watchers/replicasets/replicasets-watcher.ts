import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseReplicaSetJsonLine } from "./replicasets-parser";

const registry = createResourceWatcherRegistry(
  "get replicasets --all-namespaces -o json --watch-only --output-watch-events",
  parseReplicaSetJsonLine,
);

export function startReplicaSetsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopReplicaSetsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
