import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cases = [
  {
    file: "src/lib/features/check-health/model/stream-watchers/deployments/deployments-sync.ts",
    path: "/apis/apps/v1/deployments",
    fallbackStart: "startDeploymentsWatcher",
    fallbackStop: "stopDeploymentsWatcher",
  },
  {
    file: "src/lib/features/check-health/model/stream-watchers/daemonsets/daemonsets-sync.ts",
    path: "/apis/apps/v1/daemonsets",
    fallbackStart: "startDaemonSetsWatcher",
    fallbackStop: "stopDaemonSetsWatcher",
  },
  {
    file: "src/lib/features/check-health/model/stream-watchers/statefulsets/statefulsets-sync.ts",
    path: "/apis/apps/v1/statefulsets",
    fallbackStart: "startStatefulSetsWatcher",
    fallbackStop: "stopStatefulSetsWatcher",
  },
  {
    file: "src/lib/features/check-health/model/stream-watchers/replicasets/replicasets-sync.ts",
    path: "/apis/apps/v1/replicasets",
    fallbackStart: "startReplicaSetsWatcher",
    fallbackStop: "stopReplicaSetsWatcher",
  },
  {
    file: "src/lib/features/check-health/model/stream-watchers/jobs/jobs-sync.ts",
    path: "/apis/batch/v1/jobs",
    fallbackStart: "startJobsWatcher",
    fallbackStop: "stopJobsWatcher",
  },
  {
    file: "src/lib/features/check-health/model/stream-watchers/cronjobs/cronjobs-sync.ts",
    path: "/apis/batch/v1/cronjobs",
    fallbackStart: "startCronJobsWatcher",
    fallbackStop: "stopCronJobsWatcher",
  },
];

describe("fixed workload api sync contract", () => {
  it("routes fixed-path workload sync modules through shared api sync with legacy fallback", () => {
    for (const item of cases) {
      const source = readFileSync(resolve(item.file), "utf8");
      expect(source).toContain("createApiResourceSync");
      expect(source).toContain(`getPath: () => "${item.path}"`);
      expect(source).toContain(`fallbackStart: ${item.fallbackStart}`);
      expect(source).toContain(`fallbackStop: ${item.fallbackStop}`);
    }
  });
});
