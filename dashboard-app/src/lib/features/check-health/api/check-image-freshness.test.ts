import { describe, it, expect } from "vitest";
import { checkImageFreshness } from "./check-image-freshness";

describe("checkImageFreshness", () => {
  it("returns ok when all containers have pinned tags", () => {
    const result = checkImageFreshness([
      { image: "nginx:1.25.3" },
      { image: "redis:7.2.4@sha256:abc123" },
    ]);

    expect(result.status).toBe("ok");
    expect(result.summary.totalContainers).toBe(2);
    expect(result.summary.latestTagCount).toBe(0);
  });

  it("returns warning when containers use :latest tag", () => {
    const result = checkImageFreshness([{ image: "nginx:latest" }, { image: "redis:7.2.4" }]);

    expect(result.status).toBe("warning");
    expect(result.summary.latestTagCount).toBe(1);
  });

  it("returns warning when containers have no tag", () => {
    const result = checkImageFreshness([{ image: "nginx" }, { image: "redis:7.2.4" }]);

    expect(result.status).toBe("warning");
    expect(result.summary.latestTagCount).toBe(1);
  });

  it("counts containers without digest", () => {
    const result = checkImageFreshness([
      { image: "nginx:1.25.3" },
      { image: "redis:7.2.4@sha256:abc123" },
    ]);

    expect(result.summary.noDigestCount).toBe(1);
  });

  it("handles empty container list", () => {
    const result = checkImageFreshness([]);

    expect(result.status).toBe("ok");
    expect(result.summary.totalContainers).toBe(0);
    expect(result.summary.latestTagCount).toBe(0);
    expect(result.summary.noDigestCount).toBe(0);
  });

  it("treats image with digest but no tag as untagged", () => {
    const result = checkImageFreshness([{ image: "nginx@sha256:abc123" }]);

    expect(result.status).toBe("warning");
    expect(result.summary.latestTagCount).toBe(1);
    expect(result.summary.noDigestCount).toBe(0);
  });
});
