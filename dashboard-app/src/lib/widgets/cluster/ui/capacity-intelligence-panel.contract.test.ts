import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/cluster/ui/capacity-intelligence-panel.svelte"),
  "utf8",
);

describe("capacity intelligence panel kubectl contract", () => {
  it("requests metrics.k8s.io through --raw without shell quotes", () => {
    expect(source).toContain('"get --raw=/apis/metrics.k8s.io/v1beta1/pods --request-timeout=15s"');
    expect(source).toContain(
      '"get --raw=/apis/metrics.k8s.io/v1beta1/nodes --request-timeout=15s"',
    );
    // kubectl receives argv directly; a quoted path is passed literally and
    // fails with "--raw must be a valid URL path".
    expect(source).not.toMatch(/--raw=["']/);
  });
});
