import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const summaryBootstraps = [
  {
    file: "src/lib/widgets/cluster/ui/version-audit-summary.svelte",
    runCall: 'runVersionAudit(clusterId, { source: "auto" })',
  },
  {
    file: "src/lib/widgets/cluster/ui/backup-audit-summary.svelte",
    runCall: 'runBackupAudit(clusterId, { source: "auto" })',
  },
  {
    file: "src/lib/widgets/cluster/ui/deprecation-scan-summary.svelte",
    runCall: 'runDeprecationScan(clusterId, { source: "auto" })',
  },
];

describe("summary bootstrap contract", () => {
  it("fills empty dashboard summary widgets with a cached-first auto bootstrap", () => {
    for (const entry of summaryBootstraps) {
      const source = readFileSync(resolve(entry.file), "utf8");
      expect(source).toContain("if (!summary) {");
      expect(source).toContain("void ensureSummaryLoaded();");
      expect(source).toContain(entry.runCall);
    }
  });

  it("logs visible summary state only when the rendered summary changes", () => {
    for (const entry of summaryBootstraps) {
      const source = readFileSync(resolve(entry.file), "utf8");
      expect(source).toContain("lastVisibleLogKey");
      expect(source).toContain("if (lastVisibleLogKey !== visibleLogKey)");
    }
  });

  it("renders backup summary directly from the canonical store message", () => {
    const source = readFileSync(
      resolve("src/lib/widgets/cluster/ui/backup-audit-summary.svelte"),
      "utf8",
    );
    expect(source).toContain('summary?.message ?? "Unable to verify backup"');
  });
});
