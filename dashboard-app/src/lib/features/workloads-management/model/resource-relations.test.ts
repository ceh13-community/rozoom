import { describe, expect, it } from "vitest";
import { buildResourceRelationGraph } from "./resource-relations";

describe("resource-relations", () => {
  it("builds relation graph from owners and pods", () => {
    const graph = buildResourceRelationGraph({
      root: { kind: "Deployment", name: "api", namespace: "prod" },
      ownerReferences: [{ kind: "ReplicaSet", name: "api-779f4" }],
      podRefs: [{ name: "api-779f4-abcde", namespace: "prod" }],
    });
    expect(graph.related).toEqual([
      { kind: "ReplicaSet", name: "api-779f4", namespace: "prod" },
      { kind: "Pod", name: "api-779f4-abcde", namespace: "prod" },
    ]);
  });
});
