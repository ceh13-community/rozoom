import type { JobItem } from "$shared/model/clusters";
import { initWatchParsers } from "../register-parsers";
import { setInitialJobs } from "./jobs-store";
import { startJobsWatcher, stopJobsWatcher } from "./jobs-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const jobsApiSync = createApiResourceSync<Partial<JobItem>>({
  getPath: () => "/apis/batch/v1/jobs",
  kind: "job",
  setInitial: setInitialJobs,
  fallbackStart: startJobsWatcher,
  fallbackStop: stopJobsWatcher,
});

export function initJobsSync(clusterId: string, initialItems?: Partial<JobItem>[]) {
  initWatchParsers();
  if (initialItems?.length) {
    setInitialJobs(clusterId, initialItems);
  }
  jobsApiSync.start(clusterId);
}

export function destroyJobsSync(clusterId: string) {
  jobsApiSync.stop(clusterId);
}
