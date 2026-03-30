import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scopedWatcherFiles = [
  {
    file: "src/lib/widgets/datalists/ui/deployments-list.svelte",
    disableCall: "setDeploymentsSyncEnabled(previousClusterId, false);",
    resetCall: "resetDeploymentsSyncStatus(previousClusterId);",
  },
  {
    file: "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
    disableCall: "setDaemonSetsSyncEnabled(previousClusterId, false);",
    resetCall: "resetDaemonSetsSyncStatus(previousClusterId);",
  },
  {
    file: "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
    disableCall: "setStatefulSetsSyncEnabled(previousClusterId, false);",
    resetCall: "resetStatefulSetsSyncStatus(previousClusterId);",
  },
  {
    file: "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
    disableCall: "setReplicaSetsSyncEnabled(previousClusterId, false);",
    resetCall: "resetReplicaSetsSyncStatus(previousClusterId);",
  },
  {
    file: "src/lib/widgets/datalists/ui/jobs-list.svelte",
    disableCall: "setJobsSyncEnabled(previousClusterId, false);",
    resetCall: "resetJobsSyncStatus(previousClusterId);",
  },
  {
    file: "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
    disableCall: "setCronJobsSyncEnabled(previousClusterId, false);",
    resetCall: "resetCronJobsSyncStatus(previousClusterId);",
  },
] as const;

describe("workload watcher cluster switch contract", () => {
  it("resets previous cluster sync status before enabling next cluster watcher", () => {
    for (const entry of scopedWatcherFiles) {
      const source = readFileSync(resolve(entry.file), "utf8");
      expect(source).toContain(entry.disableCall);
      expect(source).toContain(entry.resetCall);
      expect(source).toContain("watcherSettingsLoadedCluster");
    }
  });

  it("keeps pods watcher lifecycle guarded across cluster switches", () => {
    const source = readFileSync(
      resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
      "utf8",
    );
    expect(source).toContain("setPodsSyncEnabled(previousClusterId, false);");
    expect(source).toContain("destroyPodsSync(previousClusterId);");
    expect(source).toContain("let activeClusterId");
    expect(source).toContain("if (!data.slug || !watcherSettingsLoaded) return;");
  });

  it("guards cronjobs health watcher against stale cluster responses", () => {
    const source = readFileSync(
      resolve("src/lib/widgets/datalists/ui/cronjobs-health/cronjobs-health-list.svelte"),
      "utf8",
    );
    expect(source).toContain("let activeClusterId");
    expect(source).toContain("let refreshRequestId = 0");
    expect(source).toContain("requestId !== refreshRequestId");
  });
});
