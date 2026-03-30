import { describe, expect, it } from "vitest";
import {
  buildPodDebugCommand,
  buildPodDeleteCommand,
  buildPodDescribeCommand,
  buildPodEvictFallbackDeleteArgs,
  buildPodEvictArgs,
  buildPodLogsArgs,
  pruneSelection,
} from "./pod-actions";

describe("buildPodDeleteCommand", () => {
  it("returns null when name is missing", () => {
    expect(buildPodDeleteCommand({ namespace: "default" })).toBeNull();
  });

  it("uses default namespace when not provided", () => {
    expect(buildPodDeleteCommand({ name: "api" })).toBe("delete pod api -n default");
  });

  it("uses provided namespace", () => {
    expect(buildPodDeleteCommand({ name: "api", namespace: "prod" })).toBe(
      "delete pod api -n prod",
    );
  });
});

describe("buildPodDescribeCommand", () => {
  it("returns null when name is missing", () => {
    expect(buildPodDescribeCommand({ namespace: "default" })).toBeNull();
  });

  it("uses default namespace when not provided", () => {
    expect(buildPodDescribeCommand({ name: "api" })).toBe("describe pod api -n default");
  });

  it("uses provided namespace", () => {
    expect(buildPodDescribeCommand({ name: "api", namespace: "prod" })).toBe(
      "describe pod api -n prod",
    );
  });
});

describe("buildPodDebugCommand", () => {
  it("returns null when name is missing", () => {
    expect(buildPodDebugCommand({ namespace: "default" })).toBeNull();
  });

  it("builds debug command without target container by default", () => {
    expect(buildPodDebugCommand({ name: "api", namespace: "prod" })).toBe(
      "debug -it pod/api -n prod --image=busybox:1.36 -- /bin/sh",
    );
  });

  it("adds --target when container is provided", () => {
    expect(buildPodDebugCommand({ name: "api", namespace: "prod", container: "main" })).toBe(
      "debug -it pod/api -n prod --target=main --image=busybox:1.36 -- /bin/sh",
    );
  });
});

describe("pruneSelection", () => {
  it("keeps only available ids", () => {
    const selected = new Set(["a", "b", "c"]);
    const result = pruneSelection(selected, ["b", "d"]);
    expect([...result]).toEqual(["b"]);
  });

  it("returns the same set when empty", () => {
    const selected = new Set<string>();
    expect(pruneSelection(selected, ["a"]).size).toBe(0);
  });

  it("returns the same set when nothing is pruned", () => {
    const selected = new Set(["a", "b"]);
    const result = pruneSelection(selected, ["a", "b"]);
    expect(result).toBe(selected);
  });
});

describe("buildPodEvictArgs", () => {
  it("returns null when name is missing", () => {
    expect(buildPodEvictArgs({ namespace: "default" })).toBeNull();
  });

  it("builds args with namespace", () => {
    expect(buildPodEvictArgs({ name: "api", namespace: "prod" })).toEqual([
      "evict",
      "api",
      "--namespace",
      "prod",
    ]);
  });
});

describe("buildPodEvictFallbackDeleteArgs", () => {
  it("returns null when name is missing", () => {
    expect(buildPodEvictFallbackDeleteArgs({ namespace: "default" })).toBeNull();
  });

  it("builds fallback delete args", () => {
    expect(buildPodEvictFallbackDeleteArgs({ name: "api", namespace: "prod" })).toEqual([
      "delete",
      "pod",
      "api",
      "--namespace",
      "prod",
      "--wait=false",
    ]);
  });
});

describe("buildPodLogsArgs", () => {
  it("returns null when name is missing", () => {
    expect(buildPodLogsArgs({ namespace: "default" })).toBeNull();
  });

  it("builds logs args with defaults", () => {
    expect(buildPodLogsArgs({ name: "api", namespace: "prod" })).toEqual([
      "logs",
      "api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-containers=true",
    ]);
  });

  it("builds logs args with explicit container without all-containers flag", () => {
    expect(buildPodLogsArgs({ name: "api", namespace: "prod", container: "main" })).toEqual([
      "logs",
      "api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--container",
      "main",
    ]);
  });

  it("appends --previous when requested", () => {
    expect(buildPodLogsArgs({ name: "api", namespace: "prod", previous: true })).toEqual([
      "logs",
      "api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-containers=true",
      "--previous",
    ]);
  });

  it("appends -f when follow mode is requested", () => {
    expect(buildPodLogsArgs({ name: "api", namespace: "prod", follow: true })).toEqual([
      "logs",
      "api",
      "--namespace",
      "prod",
      "--tail=400",
      "--timestamps=true",
      "--all-containers=true",
      "-f",
    ]);
  });
});
