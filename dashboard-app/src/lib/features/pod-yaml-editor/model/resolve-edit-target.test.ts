import { beforeEach, describe, expect, it, vi } from "vitest";
import { kindToResource, resolveEditableTarget } from "./resolve-edit-target";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront }));

describe("kindToResource", () => {
  it("maps known resource kinds", () => {
    expect(kindToResource("Deployment")).toBe("deployment");
    expect(kindToResource("cronjob")).toBe("cronjob");
  });
});

describe("resolveEditableTarget", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
  });

  it("falls back to pod when cluster id is missing", async () => {
    const target = await resolveEditableTarget(undefined, { name: "p", namespace: "n" });
    expect(target).toEqual({ kind: "pod", namespace: "n", name: "p", ref: "pod/n/p" });
  });

  it("resolves deployment from replicaset owner", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({
        code: 0,
        output: JSON.stringify({
          metadata: {
            ownerReferences: [{ kind: "ReplicaSet", name: "rs-1", controller: true }],
          },
        }),
      })
      .mockResolvedValueOnce({
        code: 0,
        output: JSON.stringify({
          metadata: {
            ownerReferences: [{ kind: "Deployment", name: "deploy-1", controller: true }],
          },
        }),
      });

    const target = await resolveEditableTarget("cluster-1", {
      name: "pod-1",
      namespace: "default",
    });
    expect(target).toEqual({
      kind: "deployment",
      namespace: "default",
      name: "deploy-1",
      ref: "deployment/default/deploy-1",
    });
  });
});
