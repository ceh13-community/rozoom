import { createResourceWatcherRegistry } from "../resource-watcher-registry";

const registry = createResourceWatcherRegistry(
  "get jobs --all-namespaces -o json --watch-only --output-watch-events",
);

export function startJobsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopJobsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
