import type { WatchLifecycleHooks } from "../watcher-model";
import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseDeploymentJsonLine } from "./deployments-parser";

const registry = createResourceWatcherRegistry(
  "get deployments --all-namespaces -o json --watch-only --output-watch-events",
  parseDeploymentJsonLine,
);

export function startDeploymentsWatcher(clusterId: string, hooks?: WatchLifecycleHooks) {
  registry.start(clusterId, hooks);
}

export function stopDeploymentsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
