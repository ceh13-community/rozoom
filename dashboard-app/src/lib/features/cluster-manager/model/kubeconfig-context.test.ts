import { describe, expect, it } from "vitest";
import { kubeconfigArgs, selectContextForCluster } from "./kubeconfig-context";

const contexts = [
  { name: "first-ctx", context: { cluster: "shared", user: "first-user" } },
  { name: "other-ctx", context: { cluster: "other", user: "other-user" } },
  { name: "last-ctx", context: { cluster: "shared", user: "last-user" } },
];

describe("selectContextForCluster", () => {
  it("prefers the current-context when it points at the cluster", () => {
    expect(selectContextForCluster({ contexts, currentContext: "last-ctx" }, "shared")?.name).toBe(
      "last-ctx",
    );
  });

  it("falls back to the first context in file order", () => {
    expect(selectContextForCluster({ contexts, currentContext: "other-ctx" }, "shared")?.name).toBe(
      "first-ctx",
    );
    expect(selectContextForCluster({ contexts }, "shared")?.name).toBe("first-ctx");
  });

  it("returns null for a cluster without a context", () => {
    expect(selectContextForCluster({ contexts }, "orphan")).toBeNull();
  });
});

describe("kubeconfigArgs", () => {
  it("adds the flag only for an explicit file", () => {
    expect(kubeconfigArgs("/tmp/k.yaml")).toEqual(["--kubeconfig=/tmp/k.yaml"]);
    expect(kubeconfigArgs("")).toEqual([]);
    expect(kubeconfigArgs(null)).toEqual([]);
    expect(kubeconfigArgs(undefined)).toEqual([]);
  });
});
