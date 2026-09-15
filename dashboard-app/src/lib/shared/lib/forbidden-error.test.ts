import { describe, expect, it } from "vitest";
import { humanizeForbiddenAction, isForbiddenMessage } from "./forbidden-error";

describe("isForbiddenMessage", () => {
  it("detects the RBAC error variants kubectl and the API server emit", () => {
    expect(isForbiddenMessage("Error from server (Forbidden): deployments is forbidden")).toBe(
      true,
    );
    expect(isForbiddenMessage("Unauthorized")).toBe(true);
    expect(isForbiddenMessage("User cannot create resource silences")).toBe(true);
    expect(isForbiddenMessage("system:unauthenticated cannot list pods")).toBe(true);
    expect(isForbiddenMessage("permission denied")).toBe(true);
  });

  it("does not flag unrelated errors", () => {
    expect(isForbiddenMessage("connection refused")).toBe(false);
    expect(isForbiddenMessage("the server could not find the requested resource")).toBe(false);
  });
});

describe("humanizeForbiddenAction", () => {
  it("names the verb, resource, and namespace in plain language", () => {
    const message = humanizeForbiddenAction({
      verb: "delete",
      resource: "deployments",
      name: "web",
      namespace: "prod",
    });
    expect(message).toContain('delete deployments "web"');
    expect(message).toContain('namespace "prod"');
    expect(message).toContain("cluster administrator");
  });

  it("omits name and namespace when absent", () => {
    const message = humanizeForbiddenAction({ verb: "scale", resource: "statefulsets" });
    expect(message).toContain("scale statefulsets");
    expect(message).not.toContain("namespace");
  });
});
