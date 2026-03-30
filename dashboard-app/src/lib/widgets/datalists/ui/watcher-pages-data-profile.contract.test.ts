import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const watcherPages = [
  "src/lib/widgets/datalists/ui/deployments-list.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
  "src/lib/widgets/datalists/ui/jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
  "src/lib/widgets/datalists/ui/configuration-list.svelte",
];

const streamFirstPages = [
  {
    file: "src/lib/widgets/datalists/ui/deployments-list.svelte",
    initSync: "initDeploymentsSync",
    destroySync: "destroyDeploymentsSync",
    selector: "selectClusterDeployments",
    applyEvent: "applyDeploymentEvent",
  },
  {
    file: "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
    initSync: "initDaemonSetsSync",
    destroySync: "destroyDaemonSetsSync",
    selector: "selectClusterDaemonSets",
    applyEvent: "applyDaemonSetEvent",
  },
  {
    file: "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
    initSync: "initStatefulSetsSync",
    destroySync: "destroyStatefulSetsSync",
    selector: "selectClusterStatefulSets",
    applyEvent: "applyStatefulSetEvent",
  },
  {
    file: "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
    initSync: "initReplicaSetsSync",
    destroySync: "destroyReplicaSetsSync",
    selector: "selectClusterReplicaSets",
    applyEvent: "applyReplicaSetEvent",
  },
  {
    file: "src/lib/widgets/datalists/ui/jobs-list.svelte",
    initSync: "initJobsSync",
    destroySync: "destroyJobsSync",
    selector: "selectClusterJobs",
    applyEvent: "applyJobEvent",
  },
  {
    file: "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
    initSync: "initCronJobsSync",
    destroySync: "destroyCronJobsSync",
    selector: "selectClusterCronJobs",
    applyEvent: "applyCronJobEvent",
  },
  {
    file: "src/lib/widgets/datalists/ui/configuration-list.svelte",
    initSync: "initConfigurationSync",
    destroySync: "destroyConfigurationSync",
    selector: "selectClusterConfigurationItems",
    applyEvent: "applyConfigurationItemEvent",
  },
];

describe("watcher pages data profile contract", () => {
  it("routes polling watcher pages through the shared dashboard data profile", () => {
    for (const file of watcherPages) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain('from "$shared/lib/dashboard-data-profile.svelte"');
      expect(source).toContain("const watcherPolicy = $derived.by(() =>");
      expect(source).toContain("resolveCoreResourceSyncPolicy($dashboardDataProfile");
      expect(source).toContain("isEnabled: () => watcherPolicy.enabled");
      expect(source).toContain("getRefreshSeconds: () => watcherPolicy.refreshSeconds");
    }
  });

  it("promotes core workload watcher pages to stream-first sync with polling fallback", () => {
    for (const page of streamFirstPages) {
      const source = readFileSync(resolve(page.file), "utf8");
      expect(source).toContain("supportsStream: true");
      expect(source).toContain(page.initSync);
      expect(source).toContain(page.destroySync);
      expect(source).toContain(page.selector);
      expect(source).toContain(page.applyEvent);
      expect(source).toContain('if (watcherPolicy.mode === "stream") {');
      expect(source).toContain('if (watcherPolicy.mode !== "stream") {');
      expect(source).toContain("createMutationReconcile");
      expect(
        source.includes("mutationReconcile.track(") ||
          source.includes("mutationReconcile.schedule()"),
      ).toBe(true);
      expect(source).toContain("mutationReconcile.clearScope()");
    }
  });
});
