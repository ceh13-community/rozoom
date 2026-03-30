import { describe, expect, it } from "vitest";
import { analyzeNetworkPolicies } from "./network-policy-analyzer";

describe("network-policy-analyzer", () => {
  const ns = (name: string) => ({ metadata: { name } });
  const policy = (name: string, namespace: string, spec: Record<string, unknown>) => ({
    metadata: { name, namespace },
    spec,
  });

  it("detects fully isolated namespace", () => {
    const result = analyzeNetworkPolicies({
      namespaces: [ns("prod")],
      networkPolicies: [
        policy("deny-all", "prod", {
          podSelector: {},
          policyTypes: ["Ingress", "Egress"],
          // No ingress/egress rules = deny all
        }),
      ],
    });
    expect(result.fullyIsolated).toBe(1);
    expect(result.namespaces[0].isolationLevel).toBe("full");
  });

  it("detects ingress-only isolation", () => {
    const result = analyzeNetworkPolicies({
      namespaces: [ns("staging")],
      networkPolicies: [
        policy("deny-ingress", "staging", {
          podSelector: {},
          policyTypes: ["Ingress"],
        }),
      ],
    });
    expect(result.namespaces[0].isolationLevel).toBe("ingress-only");
    expect(result.partiallyIsolated).toBe(1);
  });

  it("detects open namespace", () => {
    const result = analyzeNetworkPolicies({
      namespaces: [ns("dev")],
      networkPolicies: [],
    });
    expect(result.open).toBe(1);
    expect(result.namespaces[0].isolationLevel).toBe("none");
  });

  it("does not count policies with podSelector as default-deny", () => {
    const result = analyzeNetworkPolicies({
      namespaces: [ns("app")],
      networkPolicies: [
        policy("app-policy", "app", {
          podSelector: { matchLabels: { app: "web" } },
          policyTypes: ["Ingress"],
        }),
      ],
    });
    expect(result.namespaces[0].hasIngressDeny).toBe(false);
    expect(result.namespaces[0].policyCount).toBe(1);
  });

  it("calculates coverage percentage", () => {
    const result = analyzeNetworkPolicies({
      namespaces: [ns("prod"), ns("staging"), ns("dev")],
      networkPolicies: [
        policy("deny", "prod", { podSelector: {}, policyTypes: ["Ingress", "Egress"] }),
      ],
    });
    // prod isolated, staging and dev open
    // coverage = 1/3 non-system = 33%
    expect(result.coveragePercent).toBe(33);
  });

  it("sorts open namespaces first", () => {
    const result = analyzeNetworkPolicies({
      namespaces: [ns("prod"), ns("dev")],
      networkPolicies: [
        policy("deny", "prod", { podSelector: {}, policyTypes: ["Ingress", "Egress"] }),
      ],
    });
    expect(result.namespaces[0].namespace).toBe("dev"); // open first
    expect(result.namespaces[1].namespace).toBe("prod"); // isolated last
  });
});
