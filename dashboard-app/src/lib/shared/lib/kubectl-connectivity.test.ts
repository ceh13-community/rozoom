import { describe, expect, it } from "vitest";
import { classifyKubectlFailure, lastStderrLine } from "./kubectl-connectivity";

// stderr shapes measured on the bundled kubectl.
const CASES: Array<[string, string, string | null]> = [
  [
    "minikube stopped",
    "E1112 22:01:03.1 memcache.go:265] couldn't get current server API group list\nUnable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
    "No route to the cluster address",
  ],
  [
    "refused",
    "The connection to the server 127.0.0.1:1 was refused - did you specify the right host or port?",
    "Connection refused",
  ],
  [
    "DNS",
    "Unable to connect to the server: dial tcp: lookup api.example.invalid: no such host",
    "Host name not found",
  ],
  [
    "silent server",
    "Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout",
    "No answer from the server",
  ],
  [
    "x509",
    "Unable to connect to the server: tls: failed to verify certificate: x509: certificate signed by unknown authority",
    "Certificate not trusted",
  ],
  ["unknown shape", "error: something nobody measured", "No answer from the server"],
];

describe("classifyKubectlFailure", () => {
  for (const [name, stderr, reason] of CASES) {
    it(`unreachable: ${name}`, () => {
      const verdict = classifyKubectlFailure(stderr);
      expect(verdict.state).toBe("unreachable");
      expect(verdict).toMatchObject({ reason, detail: lastStderrLine(stderr) });
    });
  }

  it("auth expired on a 401 in both shapes", () => {
    for (const stderr of [
      "error: You must be logged in to the server (Unauthorized)",
      "Error from server (Unauthorized): Unauthorized",
    ]) {
      expect(classifyKubectlFailure(stderr)).toMatchObject({
        state: "auth-expired",
        reason: "Credentials expired or rejected",
      });
    }
  });

  it("auth expired when the credential plugin fails", () => {
    const stderr =
      "Unable to connect to the server: getting credentials: exec: executable aws not found\n\nIt looks like you are trying to use a client-go credential plugin that is not installed.";
    expect(classifyKubectlFailure(stderr)).toMatchObject({
      state: "auth-expired",
      reason: "Credential plugin failed",
    });
  });

  it("online when the API server answered with an error (403, 404)", () => {
    for (const stderr of [
      'Error from server (Forbidden): pods is forbidden: User "viewer" cannot list resource "pods"',
      'Error from server (NotFound): namespaces "gone" not found',
    ]) {
      expect(classifyKubectlFailure(stderr)).toEqual({ state: "online" });
    }
  });

  it("keeps only the last stderr line as detail", () => {
    expect(lastStderrLine("[ERROR] [kubectl]: E1 first\n\nUnable to connect: last\n")).toBe(
      "Unable to connect: last",
    );
    expect(lastStderrLine("")).toBe("");
  });
});
