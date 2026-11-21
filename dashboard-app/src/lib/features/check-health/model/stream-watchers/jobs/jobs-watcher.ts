import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseJobJsonLine } from "./jobs-parser";

const registry = createResourceWatcherRegistry(
  "get jobs --all-namespaces -o json --watch-only --output-watch-events",
  parseJobJsonLine,
);

export function startJobsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopJobsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
