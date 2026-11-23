import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast }));

const exportCsvArtifact = vi.hoisted(() => vi.fn());
const exportTextArtifact = vi.hoisted(() => vi.fn());
vi.mock("./text-export", () => ({ exportCsvArtifact, exportTextArtifact }));

const revealItemInDir = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir }));

const homeDir = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/path", () => ({ homeDir }));

import { saveCsvExport, saveTextExport, saveTextFiles } from "./save-export";

type ToastAction = { label: string; onClick: () => void };

describe("save export", () => {
  beforeEach(() => {
    toast.success.mockReset();
    toast.error.mockReset();
    exportCsvArtifact.mockReset();
    exportTextArtifact.mockReset();
    revealItemInDir.mockReset();
    homeDir.mockReset();
    homeDir.mockResolvedValue("/home/u");
  });

  it("says where the file is, with the row count and Open folder", async () => {
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/home/u/Downloads/pods.csv",
      pathHint: "/home/u/Downloads/pods.csv",
    });

    const result = await saveCsvExport({ filename: "pods.csv", csv: '"Name"', rows: 3 });

    expect(result?.path).toBe("/home/u/Downloads/pods.csv");
    expect(exportCsvArtifact).toHaveBeenCalledWith({ filename: "pods.csv", csv: '"Name"' });
    expect(toast.success).toHaveBeenCalledWith(
      "Saved to ~/Downloads/pods.csv",
      expect.objectContaining({
        description: "3 rows",
        action: expect.objectContaining({ label: "Open folder" }),
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Open folder shows the saved file in the file manager", async () => {
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/home/u/Downloads/pods.csv",
      pathHint: "/home/u/Downloads/pods.csv",
    });
    revealItemInDir.mockResolvedValue(undefined);

    await saveCsvExport({ filename: "pods.csv", csv: "x" });
    const action = (toast.success.mock.calls[0][1] as { action: ToastAction }).action;
    action.onClick();
    await vi.waitFor(() =>
      expect(revealItemInDir).toHaveBeenCalledWith("/home/u/Downloads/pods.csv"),
    );
  });

  it("says why Open folder failed", async () => {
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/home/u/Downloads/pods.csv",
      pathHint: "/home/u/Downloads/pods.csv",
    });
    revealItemInDir.mockRejectedValue(new Error("no file manager"));

    await saveCsvExport({ filename: "pods.csv", csv: "x" });
    (toast.success.mock.calls[0][1] as { action: ToastAction }).action.onClick();
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not open the folder: no file manager"),
    );
  });

  it("shows the reason and resolves null when the file was not saved", async () => {
    exportTextArtifact.mockRejectedValue(new Error("unknown path"));

    const result = await saveTextExport({ filename: "report.json", text: "{}" });

    expect(result).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Could not save report.json: unknown path");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("passes the file type through and names a browser download without a folder action", async () => {
    exportTextArtifact.mockResolvedValue({
      method: "browser-download",
      path: "report.json",
      pathHint: "~/Downloads/report.json",
    });

    await saveTextExport({ filename: "report.json", text: "{}", mimeType: "application/json" });

    expect(exportTextArtifact).toHaveBeenCalledWith({
      filename: "report.json",
      text: "{}",
      mimeType: "application/json",
    });
    expect(toast.success).toHaveBeenCalledWith("Downloaded report.json", {
      description: undefined,
    });
  });

  it("keeps the full path outside the home folder or when home is unknown", async () => {
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/srv/exports/pods.csv",
      pathHint: "/srv/exports/pods.csv",
    });
    await saveCsvExport({ filename: "pods.csv", csv: "x" });
    expect(toast.success.mock.calls[0][0]).toBe("Saved to /srv/exports/pods.csv");

    homeDir.mockRejectedValue(new Error("no home"));
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/home/u/Downloads/pods.csv",
      pathHint: "/home/u/Downloads/pods.csv",
    });
    await saveCsvExport({ filename: "pods.csv", csv: "x" });
    expect(toast.success.mock.calls[1][0]).toBe("Saved to /home/u/Downloads/pods.csv");

    homeDir.mockResolvedValue("/home/u");
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/home/user2/Downloads/pods.csv",
      pathHint: "/home/user2/Downloads/pods.csv",
    });
    await saveCsvExport({ filename: "pods.csv", csv: "x" });
    expect(toast.success.mock.calls[2][0]).toBe("Saved to /home/user2/Downloads/pods.csv");
  });

  it("one row reads as a row", async () => {
    exportCsvArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/d/a.csv",
      pathHint: "/d/a.csv",
    });
    await saveCsvExport({ filename: "a.csv", csv: "x", rows: 1 });
    expect(toast.success.mock.calls[0][1]).toEqual(
      expect.objectContaining({ description: "1 row" }),
    );
  });

  it("several files: one message with the count and the folder", async () => {
    exportTextArtifact
      .mockResolvedValueOnce({
        method: "tauri-download",
        path: "/home/u/Downloads/a.yaml",
        pathHint: "",
      })
      .mockResolvedValueOnce({
        method: "tauri-download",
        path: "/home/u/Downloads/b.yaml",
        pathHint: "",
      });

    const saved = await saveTextFiles([
      { filename: "a.yaml", text: "a" },
      { filename: "b.yaml", text: "b" },
    ]);

    expect(saved).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      "Saved 2 files to ~/Downloads",
      expect.objectContaining({ action: expect.objectContaining({ label: "Open folder" }) }),
    );
  });

  it("several files: the first failure stops and says how many were saved", async () => {
    exportTextArtifact
      .mockResolvedValueOnce({
        method: "tauri-download",
        path: "/home/u/Downloads/a.yaml",
        pathHint: "",
      })
      .mockRejectedValueOnce('not a plain file name: "b:c.yaml"');

    const saved = await saveTextFiles([
      { filename: "a.yaml", text: "a" },
      { filename: "b:c.yaml", text: "b" },
      { filename: "c.yaml", text: "c" },
    ]);

    expect(saved).toBeNull();
    expect(exportTextArtifact).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(
      'Could not save b:c.yaml: not a plain file name: "b:c.yaml" (1 of 3 saved)',
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("one file goes through the single-file message, none saves nothing", async () => {
    exportTextArtifact.mockResolvedValue({
      method: "tauri-download",
      path: "/home/u/Downloads/a.yaml",
      pathHint: "",
    });
    await saveTextFiles([{ filename: "a.yaml", text: "a" }]);
    expect(toast.success.mock.calls[0][0]).toBe("Saved to ~/Downloads/a.yaml");
    expect(await saveTextFiles([])).toEqual([]);
  });
});
