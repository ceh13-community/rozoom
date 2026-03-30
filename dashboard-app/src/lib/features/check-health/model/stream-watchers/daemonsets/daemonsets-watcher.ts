import { createResourceWatcherRegistry } from "../resource-watcher-registry";

const registry = createResourceWatcherRegistry(
  "get daemonsets --all-namespaces -o json --watch-only --output-watch-events",
);

export function startDaemonSetsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopDaemonSetsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
