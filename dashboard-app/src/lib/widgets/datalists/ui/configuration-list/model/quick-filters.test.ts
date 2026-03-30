import { describe, expect, it } from "vitest";
import { applyQuickFilterRows } from "./quick-filters";

const rows = [
  {
    problemScore: 0,
    phase: "Bound",
    ports: 2,
    isDefaultStorageClass: true,
    raw: { spec: { policyTypes: ["Ingress"] } },
  },
  {
    problemScore: 150,
    phase: "Pending",
    ports: 0,
    isDefaultStorageClass: false,
    raw: { spec: { policyTypes: [] } },
  },
];

describe("configuration quick filters", () => {
  it("filters unbound rows", () => {
    const filtered = applyQuickFilterRows(rows, "unbound");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].phase).toBe("Pending");
  });

  it("filters default storage class rows", () => {
    const filtered = applyQuickFilterRows(rows, "default-storageclass");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].isDefaultStorageClass).toBe(true);
  });

  it("filters rolebindings without subjects", () => {
    const filtered = applyQuickFilterRows(
      [
        { ...rows[0], raw: { subjects: [{ kind: "ServiceAccount", name: "default" }] } },
        { ...rows[1], raw: { subjects: [] } },
      ],
      "no-subjects",
    );
    expect(filtered).toHaveLength(1);
    expect((filtered[0].raw as { subjects: unknown[] }).subjects).toHaveLength(0);
  });

  it("filters wildcard RBAC rules", () => {
    const filtered = applyQuickFilterRows(
      [
        { ...rows[0], raw: { rules: [{ verbs: ["get"], resources: ["pods"] }] } },
        { ...rows[1], raw: { rules: [{ verbs: ["*"], resources: ["*"] }] } },
      ],
      "wildcard-rules",
    );
    expect(filtered).toHaveLength(1);
  });

  it("filters CRDs with deprecated versions", () => {
    const filtered = applyQuickFilterRows(
      [
        { ...rows[0], raw: { spec: { versions: [{ name: "v1", deprecated: false }] } } },
        { ...rows[1], raw: { spec: { versions: [{ name: "v1beta1", deprecated: true }] } } },
      ],
      "crd-deprecated-versions",
    );
    expect(filtered).toHaveLength(1);
  });

  it("filters orphan PV rows", () => {
    const filtered = applyQuickFilterRows(
      [
        {
          ...rows[0],
          raw: { spec: { claimRef: { name: "claim-a" } }, status: { phase: "Bound" } },
        },
        {
          ...rows[1],
          raw: { spec: {}, status: { phase: "Available" } },
        },
      ],
      "orphan-pv",
    );
    expect(filtered).toHaveLength(1);
  });

  it("filters drifted rows", () => {
    const filtered = applyQuickFilterRows(
      [
        { ...rows[0], raw: { metadata: {}, spec: { a: 1 } } },
        {
          ...rows[1],
          raw: {
            metadata: {
              annotations: {
                "kubectl.kubernetes.io/last-applied-configuration": JSON.stringify({
                  spec: { a: 1 },
                }),
              },
            },
            spec: { a: 2 },
          },
        },
      ],
      "drifted",
    );
    expect(filtered).toHaveLength(1);
  });
});
