import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"), "utf8");
const sourceV2 = readFileSync(
  resolve("src/lib/widgets/cluster/ui/cluster-info-card-v2.svelte"),
  "utf8",
);

describe("cluster info card primary alert contract", () => {
  it("renders a primary alert section driven by overview diagnostics", () => {
    expect(source).toContain("buildPrimaryAlert,");
    expect(source).toContain("humanizeClusterError,");
    expect(source).toContain("isConnectionError,");
    expect(source).toContain('from "$widgets/datalists/ui/model/overview-diagnostics";');
    expect(source).toContain("const primaryAlert = $derived.by(");
    expect(source).toContain("Initial refresh required");
    expect(source).toContain("Scheduled updates start after that.");
    expect(source).toContain("Primary Alert");
    expect(source).toContain("{primaryAlert.title}");
    expect(source).toContain("{primaryAlert.detail}");
  });

  it("passes loading and paused state to buildPrimaryAlert in both cards", () => {
    // Without these options the alert claims "wait for health checks"
    // even when the linter is off and no check will ever run.
    for (const src of [source, sourceV2]) {
      expect(src).toContain(
        "buildPrimaryAlert(lastCheck, { loading: isRefreshLoading, paused: !effectiveLinter })",
      );
    }
  });
});
