import { toast } from "svelte-sonner";
import { exportCsvArtifact, exportTextArtifact, type TextExportResult } from "./text-export";

// Every Download and Export button saves through here. The file goes to the Downloads folder
// (a browser download outside the desktop app), and the user always learns the outcome:
// "Saved to <path>" with Open folder, or the reason the file was not saved.

const SAVED_TOAST_MS = 8000;

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "unknown error";
}

/** The path as people read it: the home folder shown as ~. Falls back to the full path. */
export async function displayPath(path: string): Promise<string> {
  try {
    const { homeDir } = await import("@tauri-apps/api/path");
    const home = (await homeDir()).replace(/[\\/]+$/, "");
    if (home && (path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`))) {
      return `~${path.slice(home.length)}`;
    }
  } catch {
    // No home folder known: the full path is still right.
  }
  return path;
}

/** Opens the file manager on the saved file. */
export async function revealSavedExport(path: string): Promise<void> {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch (error) {
    toast.error(`Could not open the folder: ${errorText(error)}`);
  }
}

async function save(
  filename: string,
  rows: number | undefined,
  write: () => Promise<TextExportResult>,
): Promise<TextExportResult | null> {
  try {
    const result = await write();
    const description = rows === undefined ? undefined : `${rows} ${rows === 1 ? "row" : "rows"}`;
    if (result.method === "tauri-download") {
      toast.success(`Saved to ${await displayPath(result.path)}`, {
        description,
        duration: SAVED_TOAST_MS,
        action: { label: "Open folder", onClick: () => void revealSavedExport(result.path) },
      });
    } else {
      toast.success(`Downloaded ${filename}`, { description });
    }
    return result;
  } catch (error) {
    toast.error(`Could not save ${filename}: ${errorText(error)}`);
    return null;
  }
}

/** Saves a text file and tells the user where it is. Resolves null when it could not be saved. */
export function saveTextExport(options: {
  filename: string;
  text: string;
  mimeType?: string;
  rows?: number;
}): Promise<TextExportResult | null> {
  const { filename, text, mimeType, rows } = options;
  return save(filename, rows, () => exportTextArtifact({ filename, text, mimeType }));
}

/** Saves a CSV file and tells the user where it is. Resolves null when it could not be saved. */
export function saveCsvExport(options: {
  filename: string;
  csv: string;
  rows?: number;
}): Promise<TextExportResult | null> {
  const { filename, csv, rows } = options;
  return save(filename, rows, () => exportCsvArtifact({ filename, csv }));
}

function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : path;
}

/**
 * Saves several files with one message: "Saved N files to <folder>" with Open folder, or the
 * first failure with how many were saved before it. One file behaves as saveTextExport.
 */
export async function saveTextFiles(
  files: { filename: string; text: string; mimeType?: string }[],
): Promise<TextExportResult[] | null> {
  if (files.length === 0) return [];
  if (files.length === 1) {
    const result = await saveTextExport(files[0]);
    return result ? [result] : null;
  }
  const saved: TextExportResult[] = [];
  for (const file of files) {
    try {
      saved.push(await exportTextArtifact(file));
    } catch (error) {
      const progress = saved.length > 0 ? ` (${saved.length} of ${files.length} saved)` : "";
      toast.error(`Could not save ${file.filename}: ${errorText(error)}${progress}`);
      return null;
    }
  }
  const last = saved[saved.length - 1];
  if (last.method === "tauri-download") {
    toast.success(`Saved ${saved.length} files to ${await displayPath(folderOf(last.path))}`, {
      duration: SAVED_TOAST_MS,
      action: { label: "Open folder", onClick: () => void revealSavedExport(last.path) },
    });
  } else {
    toast.success(`Downloaded ${saved.length} files`);
  }
  return saved;
}
