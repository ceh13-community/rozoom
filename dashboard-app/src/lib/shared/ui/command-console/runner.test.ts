import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleSession } from "./session.svelte";

vi.mock("$shared/api/cli", () => ({
  execCliForCluster: vi.fn(),
}));

import { execCliForCluster } from "$shared/api/cli";
import { runCommand, runSequence } from "./runner";

describe("runCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixes output with a shell-style banner of tool + args", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      stdout: "release installed",
      stderr: "",
      code: 0,
    });
    const session = createConsoleSession();
    session.start();

    const result = await runCommand(
      "helm",
      ["upgrade", "--install", "nginx", "bitnami/nginx"],
      "cluster-a",
      session,
    );

    expect(result.code).toBe(0);
    expect(session.output).toContain("$ helm upgrade --install nginx bitnami/nginx\n");
    expect(session.output).toContain("release installed");
  });

  it("appends stderr as part of the transcript", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      stdout: "",
      stderr: "Error: chart not found",
      code: 1,
    });
    const session = createConsoleSession();
    session.start();

    const result = await runCommand("helm", ["status", "missing"], "c", session);

    expect(result.code).toBe(1);
    expect(session.output).toContain("Error: chart not found");
  });

  it("surfaces synchronous throws from the CLI into the transcript", async () => {
    vi.mocked(execCliForCluster).mockRejectedValue(new Error("binary not found"));
    const session = createConsoleSession();
    session.start();

    const result = await runCommand("helm", ["version"], "c", session);

    expect(result.success).toBe(false);
    expect(session.output).toContain("error: binary not found");
  });

  it("skips execution when the session was cancelled before starting", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      stdout: "ran anyway",
      stderr: "",
      code: 0,
    });
    const session = createConsoleSession();
    session.start();
    session.cancel();

    const result = await runCommand("helm", ["version"], "c", session);

    expect(result.code).toBe(130);
    expect(session.output).toContain("canceled before start");
    expect(execCliForCluster).not.toHaveBeenCalled();
  });
});

describe("runSequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs every command when each succeeds", async () => {
    vi.mocked(execCliForCluster).mockResolvedValue({
      stdout: "ok",
      stderr: "",
      code: 0,
    });
    const session = createConsoleSession();
    session.start();

    const outcome = await runSequence("c", session, [
      { tool: "helm", args: ["repo", "add", "foo", "https://foo"] },
      { tool: "helm", args: ["repo", "update"] },
      { tool: "helm", args: ["upgrade", "--install", "foo", "foo/bar"] },
    ]);

    expect(outcome.success).toBe(true);
    expect(outcome.stoppedAt).toBe(3);
    expect(execCliForCluster).toHaveBeenCalledTimes(3);
  });

  it("stops at the first failing command and reports its index", async () => {
    vi.mocked(execCliForCluster)
      .mockResolvedValueOnce({ stdout: "added", stderr: "", code: 0 })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: unauthorized",
        code: 1,
      });
    const session = createConsoleSession();
    session.start();

    const outcome = await runSequence("c", session, [
      { tool: "helm", args: ["repo", "add", "foo", "https://foo"] },
      { tool: "helm", args: ["repo", "update"] },
      { tool: "helm", args: ["upgrade", "--install", "foo", "foo/bar"] },
    ]);

    expect(outcome.success).toBe(false);
    expect(outcome.stoppedAt).toBe(1);
    expect(execCliForCluster).toHaveBeenCalledTimes(2);
    expect(session.output).toContain("Error: unauthorized");
  });

  it("bails out mid-sequence when the session is cancelled", async () => {
    vi.mocked(execCliForCluster).mockImplementationOnce(async () => {
      return { stdout: "added", stderr: "", code: 0 };
    });
    const session = createConsoleSession();
    session.start();

    // Cancel after the first call
    vi.mocked(execCliForCluster).mockImplementationOnce(async () => {
      session.cancel();
      return { stdout: "update", stderr: "", code: 0 };
    });

    const outcome = await runSequence("c", session, [
      { tool: "helm", args: ["repo", "add", "foo", "https://foo"] },
      { tool: "helm", args: ["repo", "update"] },
      { tool: "helm", args: ["upgrade", "--install", "foo", "foo/bar"] },
    ]);

    expect(outcome.success).toBe(false);
    expect(outcome.stoppedAt).toBe(2);
    expect(execCliForCluster).toHaveBeenCalledTimes(2);
  });
});
