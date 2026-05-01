import { describe, expect, it } from "vitest";
import { resolveClusterDisplayName } from "./cluster-platform";

describe("resolveClusterDisplayName", () => {
  it("uses displayName when provided", () => {
    expect(resolveClusterDisplayName({ displayName: "Prod", name: "anything" })).toBe("Prod");
  });

  it("trims whitespace from displayName", () => {
    expect(resolveClusterDisplayName({ displayName: "  Prod  ", name: "x" })).toBe("Prod");
  });

  it("extracts trailing name from EKS ARN", () => {
    expect(
      resolveClusterDisplayName({
        name: "arn:aws:eks:us-east-1:058264254041:cluster/prod-7env",
      }),
    ).toBe("prod-7env");
  });

  it("handles hyphenated and dotted EKS cluster names inside ARN", () => {
    expect(
      resolveClusterDisplayName({
        name: "arn:aws:eks:eu-west-2:111122223333:cluster/team.backend-prod",
      }),
    ).toBe("team.backend-prod");
  });

  it("extracts trailing segment from GKE context names", () => {
    expect(resolveClusterDisplayName({ name: "gke_my-project-123_us-central1_prod-cluster" })).toBe(
      "prod-cluster",
    );
  });

  it("returns raw name for short / non-prefixed identifiers", () => {
    expect(resolveClusterDisplayName({ name: "minikube" })).toBe("minikube");
    expect(resolveClusterDisplayName({ name: "k3d-dev" })).toBe("k3d-dev");
  });

  it("returns empty string when nothing is set", () => {
    expect(resolveClusterDisplayName({})).toBe("");
    expect(resolveClusterDisplayName({ name: "  " })).toBe("");
  });

  it("prefers displayName over ARN even when ARN is valid", () => {
    expect(
      resolveClusterDisplayName({
        displayName: "Team A prod",
        name: "arn:aws:eks:us-east-1:058264254041:cluster/prod-7env",
      }),
    ).toBe("Team A prod");
  });
});
