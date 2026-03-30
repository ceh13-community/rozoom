import { createResourceWatcherRegistry } from "../resource-watcher-registry";

const registry = createResourceWatcherRegistry(
  "get statefulsets --all-namespaces -o json --watch-only --output-watch-events",
);

export function startStatefulSetsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopStatefulSetsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
