import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMkdir = vi.fn();
const mockWriteTextFile = vi.fn();
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1, Download: 2 },
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  hardenPrivateFiles,
  mkdirPrivate,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  writePrivateTextFile,
} from "./private-files";

describe("private files", () => {
  beforeEach(() => {
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockWriteTextFile.mockReset().mockResolvedValue(undefined);
    mockInvoke.mockReset();
  });

  it("creates directories owner-only, relative to a base directory", async () => {
    await mkdirPrivate("configs", 1);
    expect(mockMkdir).toHaveBeenCalledWith("configs", {
      recursive: true,
      mode: PRIVATE_DIR_MODE,
      baseDir: 1,
    });
    expect(PRIVATE_DIR_MODE).toBe(0o700);
  });

  it("creates directories owner-only from an absolute path", async () => {
    await mkdirPrivate("/abs/dir");
    expect(mockMkdir).toHaveBeenCalledWith("/abs/dir", { recursive: true, mode: 0o700 });
  });

  it("writes files owner-only", async () => {
    await writePrivateTextFile("configs/x.yaml", "apiVersion: v1", 1);
    expect(mockWriteTextFile).toHaveBeenCalledWith("configs/x.yaml", "apiVersion: v1", {
      mode: PRIVATE_FILE_MODE,
      baseDir: 1,
    });
    await writePrivateTextFile("/tmp/helm-values-1.yaml", "a: 1");
    expect(mockWriteTextFile).toHaveBeenLastCalledWith("/tmp/helm-values-1.yaml", "a: 1", {
      mode: 0o600,
    });
  });

  it("returns the Rust report and swallows a missing runtime", async () => {
    mockInvoke.mockResolvedValueOnce({ dirsFixed: 1, filesFixed: 3, errors: [] });
    await expect(hardenPrivateFiles()).resolves.toEqual({
      dirsFixed: 1,
      filesFixed: 3,
      errors: [],
    });
    expect(mockInvoke).toHaveBeenCalledWith("harden_private_files");

    mockInvoke.mockRejectedValueOnce(new Error("not in tauri"));
    await expect(hardenPrivateFiles()).resolves.toBeNull();
  });
});
