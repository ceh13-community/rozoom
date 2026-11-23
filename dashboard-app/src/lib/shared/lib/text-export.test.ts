import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const isTauriAvailableMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("./tauri-runtime", () => ({
  isTauriAvailable: () => isTauriAvailableMock(),
}));

describe("buildTextExportFilename", async () => {
  const { buildTextExportFilename } = await import("./text-export");

  it("normalizes parts and appends a timestamp", () => {
    const date = new Date("2026-03-09T19:14:55.123Z");
    expect(
      buildTextExportFilename("support bundle", ["Cluster A", "Debug Describe"], "txt", date),
    ).toBe("support-bundle-cluster-a-debug-describe-2026-03-09T19-14-55-123Z.txt");
  });
});

describe("exportTextArtifact", async () => {
  const { exportCsvArtifact, exportTextArtifact } = await import("./text-export");

  beforeEach(() => {
    invoke.mockReset();
    isTauriAvailableMock.mockReset();
  });

  it("saves through the app into the Downloads folder and returns its real path", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    invoke.mockResolvedValue("/home/u/Downloads/debug-describe.txt");

    const result = await exportTextArtifact({
      filename: "debug-describe.txt",
      text: "kubectl describe pod/api -n prod",
    });

    expect(invoke).toHaveBeenCalledWith("save_download", {
      filename: "debug-describe.txt",
      contents: "kubectl describe pod/api -n prod",
    });
    expect(result).toEqual({
      method: "tauri-download",
      path: "/home/u/Downloads/debug-describe.txt",
      pathHint: "/home/u/Downloads/debug-describe.txt",
    });
  });

  it("shows the folder the app saved into, not a fixed ~/Downloads", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    invoke.mockResolvedValue("/home/u/Завантаження/pods.csv");

    const result = await exportTextArtifact({ filename: "pods.csv", text: "x" });

    expect(result.path).toBe("/home/u/Завантаження/pods.csv");
  });

  it("passes the app's error on", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    invoke.mockRejectedValue("cannot write /home/u/Downloads/pods.csv: Permission denied");

    await expect(exportTextArtifact({ filename: "pods.csv", text: "x" })).rejects.toBe(
      "cannot write /home/u/Downloads/pods.csv: Permission denied",
    );
  });

  it("falls back to a browser download outside Tauri", async () => {
    isTauriAvailableMock.mockReturnValue(false);
    const originalCreateElement = document.createElement.bind(document);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:debug");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const appendChild = vi.spyOn(document.body, "appendChild");
    const createElement = vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
    ) => {
      if (tagName === "a") {
        const anchor = originalCreateElement("a");
        vi.spyOn(anchor, "click").mockImplementation(() => {});
        return anchor;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const result = await exportTextArtifact({
      filename: "debug-describe.txt",
      text: "describe output",
    });

    const anchor = appendChild.mock.calls[0]?.[0] as HTMLAnchorElement | undefined;
    expect(anchor).toBeDefined();
    expect(anchor?.click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:debug");
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      method: "browser-download",
      path: "debug-describe.txt",
      pathHint: "~/Downloads/debug-describe.txt",
    });

    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    appendChild.mockRestore();
  });

  it("exports CSV files with a UTF-8 BOM and the Downloads path", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    invoke.mockResolvedValue("/home/u/Downloads/nodes-status.csv");

    const result = await exportCsvArtifact({
      filename: "nodes-status.csv",
      csv: '"name"\n"node-a"',
    });

    expect(invoke).toHaveBeenCalledWith("save_download", {
      filename: "nodes-status.csv",
      contents: '﻿"name"\n"node-a"',
    });
    expect(result).toEqual({
      method: "tauri-download",
      path: "/home/u/Downloads/nodes-status.csv",
      pathHint: "/home/u/Downloads/nodes-status.csv",
    });
  });
});
