import { describe, expect, it } from "vitest";
import { resolvePageClusterName } from "./resolve-page-cluster-name";

describe("resolvePageClusterName", () => {
  it("prefers explicit page data name", () => {
    expect(
      resolvePageClusterName({
        name: "minikube",
        slug: "c595d4b2-20a4-4fe9-b254-5300130893ae",
        title: "Pods - Cluster: c595d4b2-20a4-4fe9-b254-5300130893ae",
      }),
    ).toBe("minikube");
  });

  it("falls back to cluster name embedded in title", () => {
    expect(
      resolvePageClusterName({
        slug: "cluster-uuid",
        title: "Pods - Cluster: local-dev",
      }),
    ).toBe("local-dev");
  });

  it("falls back to slug when no display name exists", () => {
    expect(
      resolvePageClusterName({
        slug: "cluster-uuid",
        title: "Pods",
      }),
    ).toBe("cluster-uuid");
  });
});
