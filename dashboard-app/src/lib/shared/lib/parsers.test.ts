import { describe, expect, it } from "vitest";
import { CLUSTER_DID_NOT_ANSWER, checkResponseStatus } from "./parsers";

describe("checkResponseStatus", () => {
  it("returns 0 when the API server forbids the request", () => {
    expect(
      checkResponseStatus("Error from server (Forbidden): deployments.apps is forbidden"),
    ).toBe(0);
    expect(checkResponseStatus("Forbidden")).toBe(0);
  });

  it("returns -1 for not found errors", () => {
    expect(checkResponseStatus("NotFound")).toBe(-1);
    expect(checkResponseStatus("404")).toBe(-1);
  });

  it("returns 2 for timeout errors", () => {
    expect(checkResponseStatus("request timeout")).toBe(2);
  });

  // The cluster did not answer at all: the probe says nothing about the
  // component, so it must not read "Installed but unreachable".
  it.each([
    [
      "no route (minikube stopped)",
      "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
    ],
    [
      "refused",
      "The connection to the server 127.0.0.1:1 was refused - did you specify the right host or port?",
    ],
    ["silent server", "Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout"],
    ["DNS", "Unable to connect to the server: dial tcp: lookup api.example: no such host"],
    [
      "x509",
      "Unable to connect to the server: tls: failed to verify certificate: x509: unknown authority",
    ],
    ["401", "error: You must be logged in to the server (Unauthorized)"],
  ])("returns CLUSTER_DID_NOT_ANSWER when the cluster did not answer: %s", (_, stderr) => {
    expect(checkResponseStatus(stderr)).toBe(CLUSTER_DID_NOT_ANSWER);
  });

  it("returns 0 when the API server answered that the component is unreachable", () => {
    expect(
      checkResponseStatus(
        "Error from server (ServiceUnavailable): error trying to reach service: dial tcp 10.244.0.5:8080: connect: connection refused",
      ),
    ).toBe(0);
  });

  it("returns 0 for unknown errors to avoid false green", () => {
    expect(checkResponseStatus("something unexpected")).toBe(0);
  });
});
