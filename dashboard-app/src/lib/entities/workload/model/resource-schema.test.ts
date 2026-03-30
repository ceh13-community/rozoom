import { describe, expect, it } from "vitest";
import { getResourceSchema, hasResourceCapability } from "./resource-schema";

describe("resource-schema registry", () => {
  it("returns schema for listed workloads and configuration resources", () => {
    expect(getResourceSchema("pods")?.title).toBe("Pods");
    expect(getResourceSchema("configmaps")?.title).toBe("ConfigMaps");
    expect(getResourceSchema("services")?.title).toBe("Services");
    expect(getResourceSchema("serviceaccounts")?.title).toBe("Service Accounts");
    expect(getResourceSchema("accessreviews")?.title).toBe("Access Reviews");
    expect(getResourceSchema("customresourcedefinitions")?.title).toBe(
      "Custom Resource Definitions",
    );
    expect(getResourceSchema("endpoints")?.title).toBe("Endpoints");
    expect(getResourceSchema("endpointslices")?.title).toBe("EndpointSlices");
    expect(getResourceSchema("ingressclasses")?.title).toBe("Ingress Classes");
    expect(getResourceSchema("portforwarding")?.title).toBe("Port Forwarding");
    expect(getResourceSchema("persistentvolumes")?.title).toBe("Persistent Volumes");
    expect(getResourceSchema("volumeattributesclasses")?.title).toBe("Volume Attributes Classes");
    expect(getResourceSchema("volumesnapshots")?.title).toBe("Volume Snapshots");
    expect(getResourceSchema("volumesnapshotcontents")?.title).toBe("Volume Snapshot Contents");
    expect(getResourceSchema("volumesnapshotclasses")?.title).toBe("Volume Snapshot Classes");
    expect(getResourceSchema("csistoragecapacities")?.title).toBe("CSI Storage Capacities");
    expect(getResourceSchema("priorityclasses")?.singularTitle).toBe("PriorityClass");
  });

  it("provides namespaced + data capabilities consistently", () => {
    expect(hasResourceCapability("secrets", "namespaced")).toBe(true);
    expect(hasResourceCapability("secrets", "hasDataSection")).toBe(true);
    expect(hasResourceCapability("services", "namespaced")).toBe(true);
    expect(hasResourceCapability("endpoints", "namespaced")).toBe(true);
    expect(hasResourceCapability("endpointslices", "namespaced")).toBe(true);
    expect(hasResourceCapability("serviceaccounts", "namespaced")).toBe(true);
    expect(hasResourceCapability("clusterroles", "namespaced")).toBe(false);
    expect(hasResourceCapability("ingressclasses", "namespaced")).toBe(false);
    expect(hasResourceCapability("portforwarding", "hasYamlEdit")).toBe(false);
    expect(hasResourceCapability("persistentvolumes", "namespaced")).toBe(false);
    expect(hasResourceCapability("volumeattributesclasses", "namespaced")).toBe(false);
    expect(hasResourceCapability("volumesnapshots", "namespaced")).toBe(true);
    expect(hasResourceCapability("volumesnapshotcontents", "namespaced")).toBe(false);
    expect(hasResourceCapability("volumesnapshotclasses", "namespaced")).toBe(false);
    expect(hasResourceCapability("csistoragecapacities", "namespaced")).toBe(true);
    expect(hasResourceCapability("priorityclasses", "namespaced")).toBe(false);
  });

  it("uses PriorityClass default columns optimized for triage", () => {
    const schema = getResourceSchema("priorityclasses");
    expect(schema?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "value",
      "globalDefault",
      "age",
    ]);
  });

  it("uses requested defaults for configuration resources", () => {
    expect(getResourceSchema("namespaces")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "labels",
      "status",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("secrets")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "labels",
      "age",
      "keys",
      "type",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("poddisruptionbudgets")?.defaultColumns.map((column) => column.id),
    ).toEqual([
      "name",
      "namespace",
      "minAvailable",
      "maxUnavailable",
      "currentHealthy",
      "desiredHealthy",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("runtimeclasses")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "handler",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("leases")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "holder",
      "age",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("horizontalpodautoscalers")?.defaultColumns.map((column) => column.id),
    ).toEqual([
      "name",
      "namespace",
      "metrics",
      "minPods",
      "maxPods",
      "replicas",
      "age",
      "status",
      "resourceVersion",
    ]);
    expect(getResourceSchema("limitranges")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("resourcequotas")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("rolebindings")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "bindings",
      "age",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("customresourcedefinitions")?.defaultColumns.map((column) => column.id),
    ).toEqual(["name", "resource", "group", "version", "scope", "age", "resourceVersion"]);
    expect(getResourceSchema("services")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "externalIP",
      "selector",
      "status",
      "ports",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("endpoints")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "endpoints",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("endpointslices")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "endpoints",
      "ports",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("ingresses")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "loadBalancers",
      "ports",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("ingressclasses")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "controller",
      "apiGroup",
      "scope",
      "kind",
      "age",
      "resourceVersion",
    ]);
    expect(getResourceSchema("networkpolicies")?.defaultColumns.map((column) => column.id)).toEqual(
      ["name", "namespace", "policyTypes", "age", "resourceVersion"],
    );
    expect(
      getResourceSchema("persistentvolumeclaims")?.defaultColumns.map((column) => column.id),
    ).toEqual([
      "name",
      "namespace",
      "storageClass",
      "size",
      "pods",
      "age",
      "status",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("persistentvolumes")?.defaultColumns.map((column) => column.id),
    ).toEqual(["name", "storageClass", "capacity", "claim", "age", "status", "resourceVersion"]);
    expect(getResourceSchema("storageclasses")?.defaultColumns.map((column) => column.id)).toEqual([
      "name",
      "provisioner",
      "reclaimPolicy",
      "isDefaultStorageClass",
      "age",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("volumeattributesclasses")?.defaultColumns.map((column) => column.id),
    ).toEqual(["name", "provisioner", "age", "resourceVersion"]);
    expect(getResourceSchema("volumesnapshots")?.defaultColumns.map((column) => column.id)).toEqual(
      ["name", "namespace", "storageClass", "size", "status", "age", "resourceVersion"],
    );
    expect(
      getResourceSchema("volumesnapshotcontents")?.defaultColumns.map((column) => column.id),
    ).toEqual([
      "name",
      "claim",
      "provisioner",
      "reclaimPolicy",
      "size",
      "status",
      "age",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("volumesnapshotclasses")?.defaultColumns.map((column) => column.id),
    ).toEqual([
      "name",
      "provisioner",
      "reclaimPolicy",
      "isDefaultStorageClass",
      "age",
      "resourceVersion",
    ]);
    expect(
      getResourceSchema("csistoragecapacities")?.defaultColumns.map((column) => column.id),
    ).toEqual(["name", "namespace", "storageClass", "capacity", "age", "resourceVersion"]);
  });
});
