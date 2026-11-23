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
      toast.success(`Saved to ${result.path}`, {
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
