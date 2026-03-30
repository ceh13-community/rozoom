import { describe, expect, it } from "vitest";
import { buildRolloutCommandArgs } from "./workload-rollout";

describe("workload-rollout helpers", () => {
  it("builds rollout status args", () => {
    expect(
      buildRolloutCommandArgs("status", {
        resource: "deployment",
        name: "api",
        namespace: "prod",
      }),
    ).toEqual(["rollout", "status", "deployment/api", "--namespace", "prod"]);
  });

  it("builds rollout history args", () => {
    expect(
      buildRolloutCommandArgs("history", {
        resource: "statefulset",
        name: "db",
        namespace: "data",
      }),
    ).toEqual(["rollout", "history", "statefulset/db", "--namespace", "data"]);
  });
});
