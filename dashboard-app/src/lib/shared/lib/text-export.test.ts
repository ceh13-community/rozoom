import { beforeEach, describe, expect, it, vi } from "vitest";

const writeTextFile = vi.fn();
const isTauriAvailableMock = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Download: "Download" },
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
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
    writeTextFile.mockReset();
    isTauriAvailableMock.mockReset();
  });

  it("writes to the Downloads directory in Tauri", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    writeTextFile.mockResolvedValue(undefined);

    const result = await exportTextArtifact({
      filename: "debug-describe.txt",
      text: "kubectl describe pod/api -n prod",
    });

    expect(writeTextFile).toHaveBeenCalledWith(
      "debug-describe.txt",
      "kubectl describe pod/api -n prod",
      {
        baseDir: "Download",
      },
    );
    expect(result).toEqual({
      method: "tauri-download",
      pathHint: "~/Downloads/debug-describe.txt",
    });
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
    expect(result).toEqual({
      method: "browser-download",
      pathHint: "~/Downloads/debug-describe.txt",
    });

    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    appendChild.mockRestore();
  });

  it("exports CSV files with a UTF-8 BOM and Downloads path hint", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    writeTextFile.mockResolvedValue(undefined);

    const result = await exportCsvArtifact({
      filename: "nodes-status.csv",
      csv: '"name"\n"node-a"',
    });

    expect(writeTextFile).toHaveBeenCalledWith("nodes-status.csv", '\uFEFF"name"\n"node-a"', {
      baseDir: "Download",
    });
    expect(result).toEqual({
      method: "tauri-download",
      pathHint: "~/Downloads/nodes-status.csv",
    });
  });
});
