import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/sveltekit", () => ({ captureException: vi.fn() }));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/fake/home"),
}));

const mkdirMock = vi.fn().mockResolvedValue(undefined);
const writeMock = vi.fn().mockResolvedValue(undefined);
const removeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeTextFile: (...args: unknown[]) => writeMock(...args),
  remove: (...args: unknown[]) => removeMock(...args),
}));

const executeMock = vi.fn();
vi.mock("$shared/api/cli", () => ({
  createCliCommand: vi.fn().mockImplementation(async (_tool, _args) => ({
    execute: executeMock,
  })),
}));

import { testKubeconfig } from "./test-connection";
import { createCliCommand } from "$shared/api/cli";

const createCliCommandMock = createCliCommand as unknown as ReturnType<typeof vi.fn>;

const okStdout = JSON.stringify({
  serverVersion: {
    gitVersion: "v1.29.4",
    platform: "linux/amd64",
  },
});

describe("testKubeconfig", () => {
  beforeEach(() => {
    executeMock.mockReset();
    createCliCommandMock.mockClear();
    writeMock.mockClear();
    removeMock.mockClear();
    mkdirMock.mockClear();
  });

  it("parses server version on success", async () => {
    executeMock.mockResolvedValueOnce({ code: 0, stdout: okStdout, stderr: "" });
    const result = await testKubeconfig("apiVersion: v1\nkind: Config\n");
    expect(result.success).toBe(true);
    expect(result.serverVersion).toBe("v1.29.4");
    expect(result.serverPlatform).toBe("linux/amd64");
    expect(result.error).toBeUndefined();
  });

  it("passes --kubeconfig and --request-timeout to kubectl", async () => {
    executeMock.mockResolvedValueOnce({ code: 0, stdout: okStdout, stderr: "" });
    await testKubeconfig("apiVersion: v1");
    const call = createCliCommandMock.mock.calls[0];
    expect(call[0]).toBe("kubectl");
    const args = call[1] as string[];
    expect(args).toContain("--kubeconfig");
    expect(args[args.indexOf("--kubeconfig") + 1]).toMatch(/\.yaml$/);
    expect(args).toContain("--request-timeout=5s");
    expect(args).toContain("version");
    expect(args).toContain("-o");
    expect(args).toContain("json");
  });

  it("writes and deletes the temp kubeconfig", async () => {
    executeMock.mockResolvedValueOnce({ code: 0, stdout: okStdout, stderr: "" });
    await testKubeconfig("apiVersion: v1");
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("still cleans up temp file when kubectl fails", async () => {
    executeMock.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "Unauthorized" });
    const result = await testKubeconfig("apiVersion: v1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("returns error when createCliCommand throws", async () => {
    createCliCommandMock.mockRejectedValueOnce(new Error("binary missing"));
    const result = await testKubeconfig("apiVersion: v1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("binary missing");
  });

  it("handles non-JSON stdout gracefully", async () => {
    executeMock.mockResolvedValueOnce({ code: 0, stdout: "garbage", stderr: "" });
    const result = await testKubeconfig("apiVersion: v1");
    expect(result.success).toBe(true);
    expect(result.serverVersion).toBeUndefined();
  });

  it("measures durationMs", async () => {
    executeMock.mockResolvedValueOnce({ code: 0, stdout: okStdout, stderr: "" });
    const result = await testKubeconfig("apiVersion: v1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
