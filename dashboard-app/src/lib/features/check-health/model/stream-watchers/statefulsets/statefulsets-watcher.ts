import type { WatchLifecycleHooks } from "../watcher-model";
import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseStatefulSetJsonLine } from "./statefulsets-parser";

const registry = createResourceWatcherRegistry(
  "get statefulsets --all-namespaces -o json --watch-only --output-watch-events",
  parseStatefulSetJsonLine,
);

export function startStatefulSetsWatcher(clusterId: string, hooks?: WatchLifecycleHooks) {
  registry.start(clusterId, hooks);
}

export function stopStatefulSetsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
