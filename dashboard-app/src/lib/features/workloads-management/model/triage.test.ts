import { describe, expect, it } from "vitest";
import { classifyProblemFetchError, selectTopProblems, type ProblemResource } from "./triage";

describe("triage", () => {
  it("returns highest score resources first", () => {
    const items: ProblemResource[] = [
      {
        id: "a",
        name: "a",
        workload: "pods",
        workloadKey: "pods",
        workloadLabel: "Pods",
        problemScore: 10,
      },
      {
        id: "b",
        name: "b",
        workload: "pods",
        workloadKey: "pods",
        workloadLabel: "Pods",
        problemScore: 90,
      },
      {
        id: "c",
        name: "c",
        workload: "pods",
        workloadKey: "pods",
        workloadLabel: "Pods",
        problemScore: 50,
      },
    ];
    expect(selectTopProblems(items, 2).map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("classifies unsupported triage fetch errors", () => {
    expect(
      classifyProblemFetchError(new Error('the server doesn\'t have a resource type "gateways"')),
    ).toBe("unsupported");
  });
});
