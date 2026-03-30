import { describe, expect, it } from "vitest";
import { detectOperators } from "./operator-catalog";

describe("operator-catalog", () => {
  it("detects operator from deployment name", () => {
    const result = detectOperators({
      crds: [],
      deployments: [
        {
          metadata: {
            name: "cert-manager-controller-manager",
            namespace: "cert-manager",
            labels: {
              "app.kubernetes.io/component": "controller",
              "app.kubernetes.io/version": "v1.14.0",
            },
          },
          spec: { replicas: 1 },
          status: { readyReplicas: 1 },
        },
      ],
    });
    expect(result.totalOperators).toBe(1);
    expect(result.operators[0].version).toBe("v1.14.0");
  });

  it("detects CRDs managed by operator", () => {
    const result = detectOperators({
      crds: [
        {
          metadata: {
            name: "certificates.cert-manager.io",
            labels: { "app.kubernetes.io/managed-by": "cert-manager" },
          },
        },
        {
          metadata: {
            name: "issuers.cert-manager.io",
            labels: { "app.kubernetes.io/managed-by": "cert-manager" },
          },
        },
      ],
      deployments: [],
    });
    expect(result.operators[0].crdCount).toBe(2);
    expect(result.totalManagedCrds).toBe(2);
  });

  it("detects unhealthy operator", () => {
    const result = detectOperators({
      crds: [],
      deployments: [
        {
          metadata: {
            name: "broken-operator",
            namespace: "ops",
            labels: { "app.kubernetes.io/component": "operator" },
          },
          spec: { replicas: 1 },
          status: { readyReplicas: 0 },
        },
      ],
    });
    expect(result.unhealthyCount).toBe(1);
  });
});
