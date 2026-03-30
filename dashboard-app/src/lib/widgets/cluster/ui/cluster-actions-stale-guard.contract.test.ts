import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guardedFiles = [
  "src/lib/widgets/cluster/ui/alerts-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/metrics-sources-panel.svelte",
  "src/lib/widgets/cluster/ui/version-audit-panel.svelte",
  "src/lib/widgets/cluster/ui/deprecation-scan-panel.svelte",
  "src/lib/widgets/cluster/ui/trivy-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/armor-hub-panel.svelte",
  "src/lib/widgets/cluster/ui/compliance-hub-panel.svelte",
] as const;

describe("cluster actions stale guard contract", () => {
  it("guards async action updates against stale cluster responses", () => {
    for (const file of guardedFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain("RequestId");
      expect(source).toContain("activeClusterId");
      expect(source).toContain("!== clusterId");
    }
  });
});
