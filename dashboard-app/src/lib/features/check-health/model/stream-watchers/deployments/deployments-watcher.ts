import { createResourceWatcherRegistry } from "../resource-watcher-registry";

const registry = createResourceWatcherRegistry(
  "get deployments --all-namespaces -o json --watch-only --output-watch-events",
);

export function startDeploymentsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopDeploymentsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
