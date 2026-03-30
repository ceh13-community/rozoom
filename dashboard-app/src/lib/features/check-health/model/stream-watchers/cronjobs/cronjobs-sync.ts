import type { CronJobItem } from "$shared/model/clusters";
import { initWatchParsers } from "../register-parsers";
import { setInitialCronJobs } from "./cronjobs-store";
import { startCronJobsWatcher, stopCronJobsWatcher } from "./cronjobs-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const cronJobsApiSync = createApiResourceSync<Partial<CronJobItem>>({
  getPath: () => "/apis/batch/v1/cronjobs",
  kind: "cronjob",
  setInitial: setInitialCronJobs,
  fallbackStart: startCronJobsWatcher,
  fallbackStop: stopCronJobsWatcher,
});

export function initCronJobsSync(clusterId: string, initialItems?: Partial<CronJobItem>[]) {
  initWatchParsers();
  if (initialItems?.length) {
    setInitialCronJobs(clusterId, initialItems);
  }
  cronJobsApiSync.start(clusterId);
}

export function destroyCronJobsSync(clusterId: string) {
  cronJobsApiSync.stop(clusterId);
}
