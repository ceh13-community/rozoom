import { describe, expect, it } from "vitest";

import { humanizeConnectError } from "./humanize-connect-error";

describe("humanizeConnectError", () => {
  it("maps expired/invalid token errors to actionable copy", () => {
    for (const raw of [
      "Unauthorized",
      "the server has asked for the client to provide credentials (401)",
      "invalid bearer token, token has expired",
      "token is expired",
    ]) {
      expect(humanizeConnectError(new Error(raw))).toBe(
        "The token is expired or invalid. Get a new one from your cluster administrator or recreate the service account.",
      );
    }
  });

  it("maps network errors and names the server URL when known", () => {
    for (const raw of [
      "connect ECONNREFUSED 10.0.0.1:6443",
      "getaddrinfo ENOTFOUND my-cluster.internal",
      "dial tcp 10.0.0.1:6443: i/o timeout",
      "fetch failed",
      "request timed out",
      "no route to host",
    ]) {
      expect(humanizeConnectError(new Error(raw), "https://10.0.0.1:6443")).toBe(
        "Could not reach https://10.0.0.1:6443. Check the server address and your network connection.",
      );
    }
  });

  it("falls back to a generic subject when no server URL is given", () => {
    expect(humanizeConnectError(new Error("fetch failed"))).toBe(
      "Could not reach the API server. Check the server address and your network connection.",
    );
  });

  it("maps TLS/CA mismatch errors", () => {
    for (const raw of [
      "x509: certificate signed by unknown authority",
      "unable to verify the first certificate",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "self-signed certificate in certificate chain",
      "tls: failed to verify certificate",
    ]) {
      expect(humanizeConnectError(new Error(raw))).toBe(
        "The CA certificate does not match this server. Make sure you are using the CA of this exact cluster.",
      );
    }
  });

  it("keeps unrecognized error messages verbatim", () => {
    expect(humanizeConnectError(new Error("kubeconfig has no clusters"))).toBe(
      "kubeconfig has no clusters",
    );
  });

  it("handles non-Error and empty-message values", () => {
    expect(humanizeConnectError("boom")).toBe("boom");
    expect(humanizeConnectError(new Error(""))).toBe(
      "Connection failed for an unknown reason. Check the app logs for details.",
    );
    expect(humanizeConnectError(undefined)).toBe(
      "Connection failed for an unknown reason. Check the app logs for details.",
    );
  });

  it("does not misread token-shaped words inside unrelated messages", () => {
    expect(humanizeConnectError(new Error('field "token" is required'))).toBe(
      'field "token" is required',
    );
  });
});
