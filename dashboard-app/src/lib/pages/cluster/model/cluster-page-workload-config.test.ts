import { describe, expect, it } from "vitest";
import { CLUSTER_SWITCH_PREFETCH_WORKLOADS } from "./cluster-page-workload-config";

describe("cluster switch prefetch workloads", () => {
  it("keeps cluster-switch prefetch focused on lightweight workloads", () => {
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("overview");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("configmaps");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("secrets");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("endpoints");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("endpointslices");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("persistentvolumeclaims");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).not.toContain("volumesnapshots");
    expect(CLUSTER_SWITCH_PREFETCH_WORKLOADS).toEqual(
      expect.arrayContaining([
        "pods",
        "deployments",
        "daemonsets",
        "statefulsets",
        "replicasets",
        "jobs",
        "cronjobs",
        "nodesstatus",
        "namespaces",
      ]),
    );
  });
});
