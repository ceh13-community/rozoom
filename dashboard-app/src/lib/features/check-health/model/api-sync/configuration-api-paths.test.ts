import { describe, expect, it } from "vitest";
import { getConfigurationApiPaths } from "./configuration-api-paths";

describe("configuration-api-paths", () => {
  it("maps stable configuration resources to their Kubernetes API paths", () => {
    expect(getConfigurationApiPaths("namespaces")).toEqual(["/api/v1/namespaces"]);
    expect(getConfigurationApiPaths("horizontalpodautoscalers")).toEqual([
      "/apis/autoscaling/v2/horizontalpodautoscalers",
    ]);
    expect(getConfigurationApiPaths("poddisruptionbudgets")).toEqual([
      "/apis/policy/v1/poddisruptionbudgets",
    ]);
    expect(getConfigurationApiPaths("storageclasses")).toEqual([
      "/apis/storage.k8s.io/v1/storageclasses",
    ]);
    expect(getConfigurationApiPaths("endpointslices")).toEqual([
      "/apis/discovery.k8s.io/v1/endpointslices",
    ]);
    expect(getConfigurationApiPaths("volumeattributesclasses")).toEqual([
      "/apis/storage.k8s.io/v1beta1/volumeattributesclasses",
    ]);
    expect(getConfigurationApiPaths("volumesnapshots")).toEqual([
      "/apis/snapshot.storage.k8s.io/v1/volumesnapshots",
    ]);
    expect(getConfigurationApiPaths("volumesnapshotcontents")).toEqual([
      "/apis/snapshot.storage.k8s.io/v1/volumesnapshotcontents",
    ]);
    expect(getConfigurationApiPaths("volumesnapshotclasses")).toEqual([
      "/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses",
    ]);
    expect(getConfigurationApiPaths("csistoragecapacities")).toEqual([
      "/apis/storage.k8s.io/v1/csistoragecapacities",
    ]);
  });

  it("offers version fallbacks for gateway api resources", () => {
    expect(getConfigurationApiPaths("gatewayclasses")).toEqual([
      "/apis/gateway.networking.k8s.io/v1/gatewayclasses",
      "/apis/gateway.networking.k8s.io/v1beta1/gatewayclasses",
    ]);
    expect(getConfigurationApiPaths("referencegrants")).toEqual([
      "/apis/gateway.networking.k8s.io/v1/referencegrants",
      "/apis/gateway.networking.k8s.io/v1beta1/referencegrants",
    ]);
  });

  it("returns an empty list for workloads that do not use configuration api sync", () => {
    expect(getConfigurationApiPaths("pods")).toEqual([]);
  });
});
