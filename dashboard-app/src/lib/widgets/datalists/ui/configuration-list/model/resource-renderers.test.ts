import { describe, expect, it } from "vitest";
import { evaluateRbacRisk, renderConfigurationSummary } from "./resource-renderers";

describe("configuration resource renderers", () => {
  it("renders service summary and score", () => {
    const output = renderConfigurationSummary("services", {
      spec: { type: "ClusterIP", ports: [{ port: 80 }] },
    });
    expect(output.details).toContain("type: ClusterIP");
    expect(output.scoreDelta).toBe(0);
  });

  it("renders namespace phase summary", () => {
    const output = renderConfigurationSummary("namespaces", {
      status: { phase: "Active" },
    });
    expect(output.details).toContain("phase: Active");
    expect(output.scoreDelta).toBe(0);
  });

  it("renders pvc unbound as problem", () => {
    const output = renderConfigurationSummary("persistentvolumeclaims", {
      status: { phase: "Pending" },
      spec: { resources: { requests: { storage: "1Gi" } } },
    });
    expect(output.details).toContain("status: Pending");
    expect(output.scoreDelta).toBeGreaterThan(0);
  });

  it("renders endpoints summary with addresses", () => {
    const output = renderConfigurationSummary("endpoints", {
      subsets: [{ addresses: [{ ip: "10.0.0.1" }], ports: [{ port: 80 }] }],
    });
    expect(output.details).toContain("addresses: 1");
    expect(output.scoreDelta).toBe(0);
  });

  it("renders endpointslice summary with readiness", () => {
    const output = renderConfigurationSummary("endpointslices", {
      endpoints: [{ conditions: { ready: true } }, { conditions: { ready: false } }],
      ports: [{ port: 80 }],
    });
    expect(output.details).toContain("endpoints: 1");
    expect(output.details).toContain("not ready: 1");
    expect(output.scoreDelta).toBeGreaterThan(0);
  });

  it("renders ingress class controller summary", () => {
    const output = renderConfigurationSummary("ingressclasses", {
      metadata: { annotations: { "ingressclass.kubernetes.io/is-default-class": "true" } },
      spec: { controller: "k8s.io/ingress-nginx" },
    });
    expect(output.details).toContain("controller: k8s.io/ingress-nginx");
    expect(output.details).toContain("default: true");
  });

  it("renders gateway class summary", () => {
    const output = renderConfigurationSummary("gatewayclasses", {
      spec: { controllerName: "example.io/gateway-controller" },
    });
    expect(output.details).toContain("controller: example.io/gateway-controller");
    expect(output.scoreDelta).toBe(0);
  });

  it("renders rolebinding summary", () => {
    const output = renderConfigurationSummary("rolebindings", {
      roleRef: { kind: "Role", name: "read-only" },
      subjects: [{ kind: "ServiceAccount", name: "default" }],
    });
    expect(output.details).toContain("subjects: 1");
    expect(output.details).toContain("role: Role/read-only");
  });

  it("detects high-risk RBAC wildcard and secrets access", () => {
    const risk = evaluateRbacRisk("clusterroles", {
      rules: [{ apiGroups: ["*"], resources: ["secrets", "*"], verbs: ["*"] }],
    });
    expect(risk.scoreDelta).toBeGreaterThan(300);
    expect(risk.findings.map((f) => f.description).join(" ")).toContain("Wildcard access");
    expect(risk.findings.map((f) => f.description).join(" ")).toContain("Secret read access");
  });

  it("renders CRD summary", () => {
    const output = renderConfigurationSummary("customresourcedefinitions", {
      spec: { group: "example.io", scope: "Namespaced", versions: [{ name: "v1" }] },
    });
    expect(output.details).toContain("group: example.io");
    expect(output.details).toContain("versions: 1");
  });

  it("renders volume attributes class summary", () => {
    const output = renderConfigurationSummary("volumeattributesclasses", {
      spec: { driverName: "ebs.csi.aws.com", parameters: { type: "gp3" } },
    });
    expect(output.details).toContain("driver: ebs.csi.aws.com");
    expect(output.details).toContain("parameters: 1");
  });

  it("renders volume snapshot summary", () => {
    const output = renderConfigurationSummary("volumesnapshots", {
      spec: { volumeSnapshotClassName: "csi-snap" },
      status: { readyToUse: true, restoreSize: "5Gi" },
    });
    expect(output.details).toContain("class: csi-snap");
    expect(output.details).toContain("ready: true");
    expect(output.scoreDelta).toBe(0);
  });

  it("renders volume snapshot content summary", () => {
    const output = renderConfigurationSummary("volumesnapshotcontents", {
      spec: {
        driver: "ebs.csi.aws.com",
        deletionPolicy: "Delete",
        volumeSnapshotRef: { namespace: "apps", name: "snap-a" },
      },
      status: { readyToUse: false },
    });
    expect(output.details).toContain("snapshot: apps/snap-a");
    expect(output.details).toContain("driver: ebs.csi.aws.com");
    expect(output.scoreDelta).toBeGreaterThan(0);
  });

  it("renders csi storage capacity summary", () => {
    const output = renderConfigurationSummary("csistoragecapacities", {
      storageClassName: "fast",
      maximumVolumeSize: "100Gi",
    });
    expect(output.details).toContain("storage class: fast");
    expect(output.details).toContain("capacity: 100Gi");
  });
});
