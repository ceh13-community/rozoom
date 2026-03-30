import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/datalists/ui/overview.svelte"), "utf8");
const runtimeSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/model/overview-runtime.ts"),
  "utf8",
);

describe("overview stale-while-revalidate cache contract", () => {
  it("keeps per-scope snapshot in memory and localStorage with TTL through the runtime model", () => {
    expect(source).toContain(
      "const overviewSnapshotsMemory = new Map<string, OverviewSnapshot>();",
    );
    expect(source).toContain(
      'const OVERVIEW_SNAPSHOT_STORAGE_PREFIX = "dashboard.overview.snapshot.v1";',
    );
    expect(source).toContain("const OVERVIEW_SNAPSHOT_TTL_MS = 15 * 60 * 1000;");
    expect(source).toContain("function getOverviewScopeKey()");
    expect(source).toContain("return createOverviewScopeKey(data);");
    expect(runtimeSource).toContain("export type OverviewSnapshot = {");
    expect(runtimeSource).toContain(
      'return [clusterId, workload, namespace, sortField, filtersKey].join("::");',
    );
    expect(runtimeSource).toContain("window.localStorage.setItem(");
    expect(runtimeSource).toContain("window.localStorage.getItem(");
  });

  it("hydrates cached snapshot before forcing background refresh", () => {
    expect(source).toContain("hydrateOverviewFromSnapshot(scopeKey);");
    expect(source).toContain("seedOverviewSyncLastUpdated(clusterId, cachedOverviewAt);");
    expect(source).toContain("const OVERVIEW_CACHED_ACTIVATION_DELAY_MS = 350;");
    expect(source).toContain(
      "void refreshOverviewSnapshot({ force: true, token }).finally(() => {",
    );
    expect(source).toContain("showingCachedOverview = true;");
    expect(source).toContain("showingCachedOverview = false;");
    expect(source).toContain(
      'Cached · {formatRelativeTime(cachedOverviewAt) ?? "just now"} · Refreshing<LoadingDots />',
    );
    expect(source).toContain("Live · Updated {liveUpdatedLabel}");
  });
});
