import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cardSource = readFileSync(
  resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"),
  "utf8",
);
const deprecationSource = readFileSync(
  resolve("src/lib/widgets/cluster/ui/deprecation-scan-summary.svelte"),
  "utf8",
);
const versionSource = readFileSync(
  resolve("src/lib/widgets/cluster/ui/version-audit-summary.svelte"),
  "utf8",
);
const backupSource = readFileSync(
  resolve("src/lib/widgets/cluster/ui/backup-audit-summary.svelte"),
  "utf8",
);

describe("lazy-load scan summaries contract", () => {
  it("cluster-info-card passes lazyLoad prop to all three scan summary components", () => {
    expect(cardSource).toContain("<DeprecationScanSummary");
    expect(cardSource).toContain("<VersionAuditSummary");
    expect(cardSource).toContain("<BackupAuditSummary");

    expect(cardSource).toContain(
      "DeprecationScanSummary clusterId={cluster.uuid} offline={cluster.offline} lazyLoad",
    );
    expect(cardSource).toContain(
      "VersionAuditSummary clusterId={cluster.uuid} offline={cluster.offline} lazyLoad",
    );
    expect(cardSource).toContain(
      "BackupAuditSummary clusterId={cluster.uuid} offline={cluster.offline} lazyLoad",
    );
  });

  it("each scan summary component accepts the lazyLoad prop", () => {
    for (const [name, source] of [
      ["DeprecationScanSummary", deprecationSource],
      ["VersionAuditSummary", versionSource],
      ["BackupAuditSummary", backupSource],
    ]) {
      expect(source, `${name} should declare lazyLoad prop`).toContain("lazyLoad?: boolean");
      expect(source, `${name} should declare manuallyActivated state`).toContain(
        "let manuallyActivated = $state(false)",
      );
    }
  });

  it("each scan summary gates auto-bootstrap on lazyLoad + manuallyActivated", () => {
    for (const [name, source] of [
      ["DeprecationScanSummary", deprecationSource],
      ["VersionAuditSummary", versionSource],
      ["BackupAuditSummary", backupSource],
    ]) {
      expect(source, `${name} should gate bootstrap on lazyLoad`).toContain(
        "if (lazyLoad && !manuallyActivated) return",
      );
    }
  });

  it("each scan summary gates polling on lazyLoad until manually activated or summary loaded", () => {
    for (const [name, source] of [
      ["DeprecationScanSummary", deprecationSource],
      ["VersionAuditSummary", versionSource],
      ["BackupAuditSummary", backupSource],
    ]) {
      expect(source, `${name} should gate polling on lazyLoad`).toContain(
        "if (lazyLoad && !manuallyActivated && !summary)",
      );
    }
  });

  it("each scan summary stops event propagation on the Load button", () => {
    for (const [name, source] of [
      ["DeprecationScanSummary", deprecationSource],
      ["VersionAuditSummary", versionSource],
      ["BackupAuditSummary", backupSource],
    ]) {
      expect(source, `${name} should stopPropagation on Load button`).toContain(
        "e.stopPropagation()",
      );
    }
  });
});
