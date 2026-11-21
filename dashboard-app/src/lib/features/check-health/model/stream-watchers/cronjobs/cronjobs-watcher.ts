import { createResourceWatcherRegistry } from "../resource-watcher-registry";
import { parseCronJobJsonLine } from "./cronjobs-parser";

const registry = createResourceWatcherRegistry(
  "get cronjobs --all-namespaces -o json --watch-only --output-watch-events",
  parseCronJobJsonLine,
);

export function startCronJobsWatcher(clusterId: string) {
  registry.start(clusterId);
}

export function stopCronJobsWatcher(clusterId: string) {
  registry.stop(clusterId);
}
