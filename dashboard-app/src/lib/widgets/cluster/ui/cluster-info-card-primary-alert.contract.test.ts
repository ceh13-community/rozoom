import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"), "utf8");

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
});
