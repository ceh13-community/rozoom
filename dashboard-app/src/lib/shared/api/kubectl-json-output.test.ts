import { describe, expect, it } from "vitest";
import { withJsonOutput } from "./kubectl-json-output";

describe("withJsonOutput", () => {
  it("appends -o json to a plain read command", () => {
    expect(withJsonOutput("get pods --all-namespaces")).toBe("get pods --all-namespaces -o json");
    expect(withJsonOutput("get nodes --request-timeout=15s")).toBe(
      "get nodes --request-timeout=15s -o json",
    );
  });

  it("leaves --raw requests alone because kubectl rejects --raw with --output", () => {
    const metrics = "get --raw=/apis/metrics.k8s.io/v1beta1/pods --request-timeout=15s";
    expect(withJsonOutput(metrics)).toBe(metrics);
    const healthz = "get --raw /healthz";
    expect(withJsonOutput(healthz)).toBe(healthz);
  });

  it("does not add a second output flag", () => {
    expect(withJsonOutput("get pods -o json")).toBe("get pods -o json");
    expect(withJsonOutput("get pods -ojson")).toBe("get pods -ojson");
    expect(withJsonOutput("get pods --output=json")).toBe("get pods --output=json");
    expect(withJsonOutput("version --client=true --output json")).toBe(
      "version --client=true --output json",
    );
  });
});
