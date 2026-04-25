import { describe, expect, it } from "vitest";
import { humanizeHelmError } from "./humanize";

describe("humanizeHelmError", () => {
  it("flags repository-name collision", () => {
    const result = humanizeHelmError(
      "Error: repository name (bitnami) already exists, please specify a different name",
    );
    expect(result.title).toBe("Repository name is taken");
    expect(result.hint).toContain("different name");
  });

  it("flags missing chart", () => {
    const result = humanizeHelmError(
      'Error: failed to download "bitnami/wrong-chart"; could not find chart',
    );
    expect(result.title).toBe("Chart not found");
    expect(result.hint).toContain("helm repo update");
  });

  it("flags release name conflict across namespaces", () => {
    const result = humanizeHelmError("Error: cannot re-use a name that is still in use");
    expect(result.title).toBe("Release name conflict");
    expect(result.hint).toContain("Pick a different name");
  });

  it("flags rollback when no revisions exist", () => {
    const result = humanizeHelmError('Error: "foo" has no deployed releases');
    expect(result.title).toBe("Nothing to rollback");
    expect(result.hint).toContain("Install it first");
  });

  it("flags install timeout with pod-events hint", () => {
    const result = humanizeHelmError("Error: timed out waiting for the condition");
    expect(result.title).toBe("Install timed out");
    expect(result.hint).toContain("Check pods");
  });

  it("flags RBAC denial", () => {
    expect(humanizeHelmError("User system:anonymous is forbidden").title).toBe("Permission denied");
    expect(humanizeHelmError("Unauthorized").title).toBe("Permission denied");
  });

  it("flags API server unreachable", () => {
    expect(humanizeHelmError("unable to connect to the server").title).toBe("Cluster unreachable");
    expect(humanizeHelmError("dial tcp: connection refused").title).toBe("Cluster unreachable");
  });

  it("flags YAML template error", () => {
    const result = humanizeHelmError(
      "Error: YAML: unmarshal error: line 22: block sequence entries are not allowed",
    );
    expect(result.title).toBe("Chart template error");
    expect(result.hint).toContain("Preview");
  });

  it("returns generic default for unknown error", () => {
    const result = humanizeHelmError("Error: random stderr nobody saw before");
    expect(result.title).toBe("Helm action failed");
    expect(result.hint).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(humanizeHelmError("TIMED OUT WAITING FOR THE CONDITION").title).toBe(
      "Install timed out",
    );
  });
});
