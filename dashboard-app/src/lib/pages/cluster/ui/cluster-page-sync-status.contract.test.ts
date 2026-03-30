import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const syncStatusSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-sync-status.ts"),
  "utf8",
);

const workloadTypes = [
  { key: "Overview", route: "overview", varName: "overviewSyncStatus" },
  { key: "Pods", route: "pods", varName: "podsSyncStatus" },
  { key: "Deployments", route: "deployments", varName: "deploymentsSyncStatus" },
  { key: "DaemonSets", route: "daemonsets", varName: "daemonSetsSyncStatus" },
  { key: "StatefulSets", route: "statefulsets", varName: "statefulSetsSyncStatus" },
  { key: "ReplicaSets", route: "replicasets", varName: "replicaSetsSyncStatus" },
  { key: "Jobs", route: "jobs", varName: "jobsSyncStatus" },
  { key: "CronJobs", route: "cronjobs", varName: "cronJobsSyncStatus" },
];

describe("cluster page sync-status contract", () => {
  it("keeps sync status blocks wired for all supported workload pages", () => {
    expect(source).toContain("const shouldShowHeaderSyncBadge = true;");
    expect(source).toContain("effectiveWorkspaceLayout === 1");
    expect(source).toContain("const headerSyncStatus = $derived.by(() => {");
    expect(source).toContain("const headerSyncStatusText = $derived.by(() => {");
    expect(source).toContain("const headerSyncLastUpdatedAt = $derived.by(() => {");
    expect(source).toContain("const headerSyncDisplayUpdatedAt = $derived.by(() => {");
    expect(source).toContain("const headerSyncDisplayText = $derived.by(() => {");
    for (const workload of workloadTypes) {
      expect(source).toContain(
        `const shouldShow${workload.key}SyncStatus = $derived(routeWorkloadType === "${workload.route}")`,
      );
    }
    expect(source).toContain(
      "{#if shouldShowHeaderSyncBadge && (headerSyncStatus || headerSyncDisplayUpdatedAt)}",
    );
  });

  it("renders updated badge with enabled/muted color logic", () => {
    expect(source).toContain('{:else if headerSyncDisplayText === "updated"}');
    expect(source).toContain("class={headerSyncDisplayEnabled");
    expect(source).toContain('? "text-green-600 dark:text-green-400"');
    expect(source).toContain(': "text-gray-500 dark:text-gray-400"');
    expect(source).toContain("headerSyncDisplayUpdatedAt");
    expect(source).toContain(
      "formatSyncUpdatedAt(headerSyncDisplayUpdatedAt, headerSyncDisplayEnabled)",
    );
  });

  it("marks sync badge as off when watcher is disabled", () => {
    expect(syncStatusSource).toContain('if (!status.enabled) return "off";');
    expect(source).toContain(
      "function formatSyncUpdatedAt(lastUpdatedAt: number, live = true): string",
    );
  });
});
