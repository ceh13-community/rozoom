import { describe, expect, it } from "vitest";
import { buildDeploymentLogsArgs, buildDeploymentPodFallbackLogsArgs } from "./deployment-log-args";
import type { DeploymentItem } from "$shared";

const deployment = {
  metadata: {
    name: "api",
    namespace: "prod",
  },
  spec: {},
  status: {},
} as DeploymentItem;

describe("buildDeploymentLogsArgs", () => {
  it("builds deployment logs args with defaults", () => {
    expect(buildDeploymentLogsArgs(deployment)).toEqual([
      "logs",
      "deployment/api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-pods=true",
      "--all-containers=true",
    ]);
  });

  it("supports stream mode, previous and explicit container", () => {
    expect(
      buildDeploymentLogsArgs(deployment, {
        follow: true,
        previous: true,
        container: "main",
      }),
    ).toEqual([
      "logs",
      "deployment/api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-pods=true",
      "--container",
      "main",
      "--previous=true",
      "-f",
    ]);
  });

  it("returns null when deployment name is missing", () => {
    expect(buildDeploymentLogsArgs({ metadata: { namespace: "prod" } } as never)).toBeNull();
  });
});

describe("buildDeploymentPodFallbackLogsArgs", () => {
  it("builds pod fallback logs args with all-containers by default", () => {
    expect(buildDeploymentPodFallbackLogsArgs("api-123", "prod")).toEqual([
      "logs",
      "api-123",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-containers=true",
    ]);
  });

  it("supports stream mode with explicit container", () => {
    expect(
      buildDeploymentPodFallbackLogsArgs("api-123", "prod", {
        follow: true,
        container: "main",
      }),
    ).toEqual([
      "logs",
      "api-123",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--container",
      "main",
      "-f",
    ]);
  });
});
