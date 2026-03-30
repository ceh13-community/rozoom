import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/cluster/ui/metrics-status.svelte"), "utf8");

describe("metrics status contract", () => {
  it("normalizes non-string metric status payloads before rendering", () => {
    expect(source).toContain("function formatMetricsStatus(status: unknown): string {");
    expect(source).toContain('if (typeof status === "string") return status;');
    expect(source).toContain('if (result === 1) return "Available";');
    expect(source).toContain('if (result === 0) return "Unreachable";');
    expect(source).toContain(
      "const statusLabel = $derived.by(() => formatMetricsStatus(metrics.status));",
    );
    expect(source).toContain("{statusLabel}");
  });
});
