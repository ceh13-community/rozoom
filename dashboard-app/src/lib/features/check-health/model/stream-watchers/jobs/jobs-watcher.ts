import type { WatchLifecycleHooks } from "../watcher-model";
import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseJobJsonLine } from "./jobs-parser";

const registry = createResourceWatcherRegistry(
  "get jobs --all-namespaces -o json --watch-only --output-watch-events",
  parseJobJsonLine,
);

export function startJobsWatcher(clusterId: string, hooks?: WatchLifecycleHooks) {
  registry.start(clusterId, hooks);
}

export function stopJobsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
