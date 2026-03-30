import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const diagnosticsPages = [
  "src/lib/widgets/cluster/ui/metrics-sources-panel.svelte",
  "src/lib/widgets/cluster/ui/alerts-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/version-audit-panel.svelte",
  "src/lib/widgets/cluster/ui/version-audit-summary.svelte",
  "src/lib/widgets/cluster/ui/backup-audit-panel.svelte",
  "src/lib/widgets/cluster/ui/backup-audit-summary.svelte",
  "src/lib/widgets/cluster/ui/deprecation-scan-panel.svelte",
  "src/lib/widgets/cluster/ui/deprecation-scan-summary.svelte",
];

describe("diagnostics data profile contract", () => {
  it("gates diagnostics polling behind the shared dashboard data profile", () => {
    for (const file of diagnosticsPages) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain('from "$shared/lib/dashboard-data-profile.svelte"');
      expect(source).toContain(
        "const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));",
      );
      expect(source).toContain("if (!autoDiagnosticsEnabled) {");
    }
  });
});
