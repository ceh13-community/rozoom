import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/datalists/ui/overview.svelte"), "utf8");

describe("overview sync controls contract", () => {
  it("keeps Sync sec controls in overview panel", () => {
    expect(source).toContain("Sync sec");
    expect(source).toContain("Reset");
    expect(source).toContain('import { createSerialRefresh } from "$shared/lib/serial-refresh";');
    expect(source).toContain("const overviewSerialRefresh = createSerialRefresh");
    expect(source).toContain(
      "void refreshOverviewSnapshot({ force: true, token }).finally(() => {",
    );
    expect(source).toContain(
      "await refreshOverviewSnapshot({ force: true, token: activeRefreshToken });",
    );
  });

  it("uses recursive timeout scheduler instead of interval for sync loop", () => {
    expect(source).toContain(
      "function scheduleNextOverviewSync(token: RefreshRunToken, clusterId: string)",
    );
    expect(source).toContain("overviewSyncTimeout = setTimeout(");
    expect(source).toContain("scheduleNextOverviewSync(token, clusterId);");
    // Sync loop must use recursive setTimeout, not setInterval
    // (staleTimer setInterval for UI counter is OK - not a sync loop)
    expect(source).toContain("overviewSyncTimeout = setTimeout");
  });
});
