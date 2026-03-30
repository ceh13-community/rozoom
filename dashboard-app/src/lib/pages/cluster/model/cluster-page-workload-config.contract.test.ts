import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-workload-config.ts"),
  "utf8",
);

describe("cluster page workload label parity contract", () => {
  it("keeps configuration workload labels aligned with page titles", () => {
    const expectedLabels = [
      'configmaps: "ConfigMaps"',
      'secrets: "Secrets"',
      'resourcequotas: "Resource Quotas"',
      'limitranges: "Limit Ranges"',
      'horizontalpodautoscalers: "Horizontal Pod Autoscalers"',
      'poddisruptionbudgets: "Pod Disruption Budgets"',
      'priorityclasses: "Priority Classes"',
      'runtimeclasses: "Runtime Classes"',
      'leases: "Leases"',
      'mutatingwebhookconfigurations: "Mutating Webhooks"',
      'validatingwebhookconfigurations: "Validating Webhooks"',
      'serviceaccounts: "Service Accounts"',
      'roles: "Roles"',
      'rolebindings: "Role Bindings"',
      'clusterroles: "Cluster Roles"',
      'clusterrolebindings: "Cluster Role Bindings"',
      'customresourcedefinitions: "Custom Resource Definitions"',
      'services: "Services"',
      'endpoints: "Endpoints"',
      'endpointslices: "EndpointSlices"',
      'ingresses: "Ingresses"',
      'ingressclasses: "Ingress Classes"',
      'gatewayclasses: "Gateway Classes"',
      'gateways: "Gateways"',
      'httproutes: "HTTP Routes"',
      'referencegrants: "Reference Grants"',
      'portforwarding: "Port Forwarding"',
      'networkpolicies: "Network Policies"',
      'persistentvolumeclaims: "Persistent Volume Claims"',
      'persistentvolumes: "Persistent Volumes"',
      'storageclasses: "Storage Classes"',
      'volumeattributesclasses: "Volume Attributes Classes"',
      'volumesnapshots: "Volume Snapshots"',
      'volumesnapshotcontents: "Volume Snapshot Contents"',
      'volumesnapshotclasses: "Volume Snapshot Classes"',
      'csistoragecapacities: "CSI Storage Capacities"',
    ];

    for (const label of expectedLabels) {
      expect(source).toContain(label);
    }
  });
});
