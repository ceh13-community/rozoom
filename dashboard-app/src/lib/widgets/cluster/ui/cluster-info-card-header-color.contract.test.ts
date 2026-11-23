import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Fleet Control Plane showed one cluster in two colours: the Detailed card
// painted its header from the status (red on Critical) while the Compact card
// kept a fixed grey header. Both cards must take the header colour from the
// same rule, so a density switch never changes what the status looks like.
const detailed = readFileSync(
  resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"),
  "utf8",
);
const compact = readFileSync(
  resolve("src/lib/widgets/cluster/ui/cluster-info-card-v2.svelte"),
  "utf8",
);

const headerClass = (source: string): string => {
  const match = source.match(/<Card\.Title\s+class="([^"]*)"/);
  if (!match) throw new Error("no <Card.Title class=...> in the card source");
  return match[1];
};

describe("cluster card header colour contract", () => {
  it("both cards derive their state from the shared rule", () => {
    for (const source of [detailed, compact]) {
      expect(source).toContain("displayClusterCardState({");
      expect(source).toContain("linterOn: effectiveLinter,");
      expect(source).toContain("disconnected,");
      expect(source).toContain("awaitingInitialRefresh,");
      expect(source).toContain("base: clusterCardColor,");
    }
  });

  it("both headers are painted from the shared state, never from a fixed class", () => {
    for (const source of [detailed, compact]) {
      const cls = headerClass(source);
      expect(cls).toContain("{displayClusterCardColor?.color}");
      expect(cls).toContain("transition-colors");
      expect(cls).not.toMatch(/\bbg-(slate|rose|emerald|amber)-\d{3}\b/);
    }
  });
});
