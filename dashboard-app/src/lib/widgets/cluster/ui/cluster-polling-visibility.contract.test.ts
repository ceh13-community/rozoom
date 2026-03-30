import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PollingFile = {
  file: string;
  stopCall: string;
};

const pollingFiles: PollingFile[] = [
  {
    file: "src/lib/widgets/cluster/ui/alerts-hub-panel.svelte",
    stopCall: "stopAlertHubPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/metrics-sources-panel.svelte",
    stopCall: "stopMetricsSourcesPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/version-audit-panel.svelte",
    stopCall: "stopVersionAuditPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/backup-audit-panel.svelte",
    stopCall: "stopBackupAuditPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/deprecation-scan-panel.svelte",
    stopCall: "stopDeprecationScanPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/version-audit-summary.svelte",
    stopCall: "stopVersionAuditPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/backup-audit-summary.svelte",
    stopCall: "stopBackupAuditPolling(clusterId);",
  },
  {
    file: "src/lib/widgets/cluster/ui/deprecation-scan-summary.svelte",
    stopCall: "stopDeprecationScanPolling(clusterId);",
  },
];

describe("cluster polling visibility contract", () => {
  it("keeps polling pages visibility-aware and stops timers when page is hidden", () => {
    for (const entry of pollingFiles) {
      const source = readFileSync(resolve(entry.file), "utf8");
      expect(source).toContain("document.visibilityState");
      expect(source).toContain('document.addEventListener("visibilitychange", handleVisibility);');
      expect(source).toContain("if (!pageVisible)");
      expect(source).toContain(entry.stopCall);
    }
  });
});
