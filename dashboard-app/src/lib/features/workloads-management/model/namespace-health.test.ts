import { describe, expect, it } from "vitest";
import { buildNamespaceHealth } from "./namespace-health";

describe("namespace-health", () => {
  const pod = (ns: string, phase: string, restarts = 0) => ({
    metadata: { namespace: ns },
    status: { phase, containerStatuses: [{ restartCount: restarts }] },
  });

  it("calculates health per namespace", () => {
    const result = buildNamespaceHealth([
      pod("prod", "Running"),
      pod("prod", "Running"),
      pod("prod", "Failed"),
      pod("dev", "Running"),
    ]);
    expect(result.entries.find((e) => e.namespace === "prod")?.healthPercent).toBe(67);
    expect(result.entries.find((e) => e.namespace === "dev")?.grade).toBe("healthy");
  });

  it("identifies worst namespace", () => {
    const result = buildNamespaceHealth([pod("bad", "Failed"), pod("good", "Running")]);
    expect(result.worstNamespace).toBe("bad");
  });

  it("handles empty input", () => {
    const result = buildNamespaceHealth([]);
    expect(result.entries).toHaveLength(0);
    expect(result.overallHealthPercent).toBe(100);
  });
});
