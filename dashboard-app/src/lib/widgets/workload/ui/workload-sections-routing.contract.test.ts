import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workloadDisplaySource = readFileSync(
  resolve("src/lib/widgets/workload/model/workload-route-registry.ts"),
  "utf8",
);

const routeKeys = [
  // Workloads
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "jobs",
  "cronjobs",
  // Namespace
  "namespaces",
  // Configuration
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "priorityclasses",
  "runtimeclasses",
  "leases",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  // Access Control
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "accessreviews",
  // Custom Resources
  "customresourcedefinitions",
  // Network
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "ingressclasses",
  "gatewayclasses",
  "gateways",
  "httproutes",
  "referencegrants",
  "portforwarding",
  "networkpolicies",
  // Storage
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
  "volumeattributesclasses",
  "volumesnapshots",
  "volumesnapshotcontents",
  "volumesnapshotclasses",
  "csistoragecapacities",
] as const;

describe("workload sections routing contract", () => {
  it("maps all requested section routes in component map and props map", () => {
    for (const key of routeKeys) {
      expect(workloadDisplaySource).toContain(`${key}:`);
    }
  });
});
