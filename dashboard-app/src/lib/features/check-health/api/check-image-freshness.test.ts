import { describe, it, expect } from "vitest";
import type { PodItem } from "$shared/model/clusters";
import { checkImageFreshness, podContainerImages } from "./check-image-freshness";

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

  // The kubelet pulls by the digest, so the tag next to it, or its absence, changes nothing.
  it("does not flag an image pinned by digest, with or without a latest tag", () => {
    const result = checkImageFreshness([
      { image: "busybox@sha256:abc123" },
      { image: "busybox:latest@sha256:abc123" },
      { image: "registry.local:5000/team/app@sha256:abc123" },
    ]);

    expect(result.status).toBe("ok");
    expect(result.summary.latestTagCount).toBe(0);
    expect(result.summary.noDigestCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  // "registry.local:5000/app" has no tag: the ":5000" belongs to the registry host.
  it("reads the tag from the last path segment only", () => {
    const result = checkImageFreshness([
      { image: "registry.local:5000/app" },
      { image: "registry.local:5000/team/app:latest" },
      { image: "registry.local:5000/team/app:2.4.1" },
      { image: "ghcr.io/org/tool:v1" },
    ]);

    expect(result.summary.latestTagCount).toBe(2);
    expect(result.items?.map((item) => item.image)).toEqual([
      "registry.local:5000/app",
      "registry.local:5000/team/app:latest",
    ]);
  });

  // The report named no containers, so the score could say how many but not which.
  it("names each container on a :latest or untagged image", () => {
    const result = checkImageFreshness([
      { image: "busybox:latest", namespace: "lint", pod: "app-1", container: "app" },
      { image: "busybox:1.36.1", namespace: "lint", pod: "app-1", container: "side" },
      { image: "alpine", namespace: "lint", pod: "job-1", container: "init" },
    ]);
    expect(result.items).toEqual([
      { namespace: "lint", pod: "app-1", container: "app", image: "busybox:latest" },
      { namespace: "lint", pod: "job-1", container: "init", image: "alpine" },
    ]);
  });
});

describe("podContainerImages", () => {
  it("lists init containers and containers of every pod, skipping ones without an image", () => {
    const pods = [
      {
        metadata: { namespace: "lint", name: "app-1" },
        spec: {
          initContainers: [{ name: "init", image: "alpine" }],
          containers: [
            { name: "app", image: "busybox:latest" },
            { name: "broken", image: "" },
          ],
        },
      },
      { metadata: { namespace: "lint", name: "bare" }, spec: {} },
    ] as unknown as PodItem[];
    expect(podContainerImages(pods)).toEqual([
      { image: "alpine", namespace: "lint", pod: "app-1", container: "init" },
      { image: "busybox:latest", namespace: "lint", pod: "app-1", container: "app" },
    ]);
  });
});
