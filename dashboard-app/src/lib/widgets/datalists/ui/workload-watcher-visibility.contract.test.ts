import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workloadWatcherFiles = [
  "src/lib/widgets/datalists/ui/overview.svelte",
  "src/lib/widgets/datalists/ui/pods-list/pods-list.svelte",
  "src/lib/widgets/datalists/ui/deployments-list.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
  "src/lib/widgets/datalists/ui/jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cronjobs-health/cronjobs-health-list.svelte",
  "src/lib/widgets/datalists/ui/configuration-list.svelte",
] as const;

const manualRefreshPages = [
  // ACCESS CONTROL / NETWORK / STORAGE pages without background polling
  "src/lib/widgets/datalists/ui/access-control/access-reviews-panel.svelte",
  "src/lib/widgets/datalists/ui/network/port-forwarding-panel.svelte",
  // OBSERVABILITY pages without continuous polling
  "src/lib/widgets/datalists/ui/pods-restarts/pods-restarts-list.svelte",
  "src/lib/widgets/datalists/ui/nodes-pressures/nodes-pressures-list.svelte",
  // CLUSTER OPS / SECURITY & COMPLIANCE / part of OBSERVABILITY
  "src/lib/widgets/cluster/ui/helm-panel.svelte",
  "src/lib/widgets/cluster/ui/deprecation-scan-panel.svelte",
  "src/lib/widgets/cluster/ui/version-audit-panel.svelte",
  "src/lib/widgets/cluster/ui/backup-audit-panel.svelte",
  "src/lib/widgets/cluster/ui/alerts-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/metrics-sources-panel.svelte",
  "src/lib/widgets/cluster/ui/armor-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/compliance-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/trivy-hub-panel.svelte",
] as const;

describe("workload watcher visibility contract", () => {
  it("keeps document visibility guards in workload watcher pages", () => {
    for (const file of workloadWatcherFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source.includes("document.visibilityState")).toBe(true);
    }
  });

  it("keeps nodes health polling visibility pause/resume in shared store", () => {
    const nodesStore = readFileSync(
      resolve("src/lib/features/check-health/model/nodes-health-store.ts"),
      "utf8",
    );
    expect(nodesStore).toContain(
      'document.addEventListener("visibilitychange", onVisibilityChange);',
    );
    expect(nodesStore).toContain("ctl.paused = hidden;");
    expect(nodesStore).toContain("if (hidden && ctl.timeoutId)");
  });

  it("keeps non-watcher section pages free from interval-based background refresh", () => {
    for (const file of manualRefreshPages) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toContain("setInterval(");
    }
  });
});
