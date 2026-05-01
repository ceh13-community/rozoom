import { describe, expect, it } from "vitest";
import { humanizeVeleroError } from "./humanize";

describe("humanizeVeleroError", () => {
  it("flags AWS InvalidAccessKeyId with rotation hint", () => {
    const result = humanizeVeleroError(
      "status code: 403, request id: ABC, api error InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records.",
    );
    expect(result.title).toBe("AWS access key not recognized");
    expect(result.hint).toContain("rotated");
  });

  it("flags AWS SignatureDoesNotMatch", () => {
    const result = humanizeVeleroError(
      "SignatureDoesNotMatch: The request signature we calculated does not match",
    );
    expect(result.title).toBe("AWS signature mismatch");
  });

  it("flags NoSuchBucket", () => {
    const result = humanizeVeleroError("NoSuchBucket: the specified bucket does not exist");
    expect(result.title).toBe("Bucket not found");
  });

  it("flags 403 Forbidden and AccessDenied identically", () => {
    expect(humanizeVeleroError("HTTP 403 Forbidden").title).toBe("Permission denied on bucket");
    expect(humanizeVeleroError("AccessDenied: Access Denied").title).toBe(
      "Permission denied on bucket",
    );
  });

  it("flags expired AWS tokens", () => {
    expect(humanizeVeleroError("ExpiredToken: ...").title).toBe("Credentials expired");
    expect(humanizeVeleroError("TokenRefreshRequired: ...").title).toBe("Credentials expired");
  });

  it("flags Azure authentication failure (requires both keywords)", () => {
    const result = humanizeVeleroError("Azure AuthenticationFailed: Server failed to authenticate");
    expect(result.title).toBe("Azure authentication failed");
    // Generic AuthenticationFailed without "azure" should fall through
    expect(humanizeVeleroError("AuthenticationFailed for realm")).not.toMatchObject({
      title: "Azure authentication failed",
    });
  });

  it("flags Azure ContainerNotFound", () => {
    expect(humanizeVeleroError("ContainerNotFound: ...").title).toBe("Azure container not found");
  });

  it("flags GCP invalid grant / JWT", () => {
    expect(humanizeVeleroError("invalid_grant: invalid grant").title).toBe(
      "GCP service-account JSON rejected",
    );
    expect(humanizeVeleroError("invalid JWT: token malformed").title).toBe(
      "GCP service-account JSON rejected",
    );
  });

  it("flags connection errors", () => {
    expect(humanizeVeleroError("dial tcp: connection refused").title).toBe(
      "Object storage endpoint unreachable",
    );
    expect(humanizeVeleroError("no route to host").title).toBe(
      "Object storage endpoint unreachable",
    );
    expect(humanizeVeleroError("ECONNREFUSED").title).toBe("Object storage endpoint unreachable");
  });

  it("flags validation errors", () => {
    expect(humanizeVeleroError("validation failed").title).toBe(
      "Backup location validation failed",
    );
    expect(humanizeVeleroError("ValidationError: schema").title).toBe(
      "Backup location validation failed",
    );
  });

  it("flags timeouts", () => {
    expect(humanizeVeleroError("context deadline exceeded: timeout").title).toBe(
      "Operation timed out",
    );
  });

  it("flags BackupStorageLocation problems", () => {
    expect(humanizeVeleroError("BackupStorageLocation is not ready").title).toBe(
      "BackupStorageLocation misconfigured",
    );
  });

  it("falls through to generic for unknown errors", () => {
    const result = humanizeVeleroError("random unknown stderr nobody catalogued");
    expect(result.title).toBe("Backup action failed");
    expect(result.hint).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(humanizeVeleroError("INVALIDACCESSKEYID").title).toBe("AWS access key not recognized");
  });
});
