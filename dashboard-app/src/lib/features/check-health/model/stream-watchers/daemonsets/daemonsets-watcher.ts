import type { WatchLifecycleHooks } from "../watcher-model";
import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseDaemonSetJsonLine } from "./daemonsets-parser";

const registry = createResourceWatcherRegistry(
  "get daemonsets --all-namespaces -o json --watch-only --output-watch-events",
  parseDaemonSetJsonLine,
);

export function startDaemonSetsWatcher(clusterId: string, hooks?: WatchLifecycleHooks) {
  registry.start(clusterId, hooks);
}

export function stopDaemonSetsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
