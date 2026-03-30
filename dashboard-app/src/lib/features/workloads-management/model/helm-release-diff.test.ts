import { describe, expect, it } from "vitest";
import { diffHelmRelease } from "./helm-release-diff";

describe("helm-release-diff", () => {
  it("finds customized values", () => {
    const result = diffHelmRelease(
      "nginx",
      { replicas: 3, image: { tag: "latest" } },
      { replicas: 1, image: { tag: "stable" } },
    );
    expect(result.customizedCount).toBe(2);
    expect(result.diffs.find((d) => d.key === "replicas")?.customized).toBe(true);
  });

  it("detects identical values", () => {
    const result = diffHelmRelease("app", { port: 8080 }, { port: 8080 });
    expect(result.customizedCount).toBe(0);
    expect(result.customizationPercent).toBe(0);
  });

  it("handles added keys", () => {
    const result = diffHelmRelease("x", { extra: "val" }, {});
    expect(result.diffs[0].chartDefault).toBe("-");
    expect(result.diffs[0].customized).toBe(true);
  });
});
