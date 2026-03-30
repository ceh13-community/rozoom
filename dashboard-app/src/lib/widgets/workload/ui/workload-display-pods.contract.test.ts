import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/workload/model/workload-route-registry.ts"),
  "utf8",
);

describe("workload display pods contract", () => {
  it("does not pass route workload snapshot into pods list props", () => {
    expect(source).toContain("pods: { ...data },");
    expect(source).not.toContain("pods: { ...data, pods: workloadData },");
  });
});
