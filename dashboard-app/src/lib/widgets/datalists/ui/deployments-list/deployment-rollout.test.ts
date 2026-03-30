import { describe, expect, it } from "vitest";
import { normalizeDeploymentRolloutResolution } from "./deployment-rollout";

describe("deployment rollout resolution", () => {
  it("treats resume on an active deployment as a noop", () => {
    expect(
      normalizeDeploymentRolloutResolution(
        "resume",
        "velero/velero",
        'error: deployments.apps "velero" is not paused',
      ),
    ).toEqual({
      kind: "noop",
      message: "Deployment velero/velero is already resumed.",
    });
  });

  it("treats pause on an already paused deployment as a noop", () => {
    expect(
      normalizeDeploymentRolloutResolution(
        "pause",
        "ns-a/api",
        'error: deployment.apps "api" is already paused',
      ),
    ).toEqual({
      kind: "noop",
      message: "Deployment ns-a/api is already paused.",
    });
  });

  it("returns actionable copy when restart is blocked by a paused deployment", () => {
    expect(
      normalizeDeploymentRolloutResolution(
        "restart",
        "velero/velero",
        'error: deployments.apps "velero" can\'t restart paused deployment (run rollout resume first)',
      ),
    ).toEqual({
      kind: "error",
      message: "Deployment velero/velero is paused. Resume it before running rollout restart.",
    });
  });
});
