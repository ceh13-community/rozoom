import { isTauriAvailable } from "./tauri-runtime";

export type TextExportResult = {
  method: "tauri-download" | "browser-download";
  /** Where the file is: the absolute path in the desktop app, the file name in a browser. */
  path: string;
  pathHint: string;
};

const DOWNLOADS_PATH_PREFIX = "~/Downloads";

export function buildTextExportFilename(
  prefix: string,
  parts: string[],
  extension: string,
  timestamp = new Date(),
) {
  const normalizedTimestamp = timestamp.toISOString().replace(/[:.]/g, "-");
  const normalizedParts = [prefix, ...parts]
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-"),
    )
    .map((part) => part.replace(/^-+|-+$/g, ""))
    .filter((part) => part.length > 0);
  return `${normalizedParts.join("-")}-${normalizedTimestamp}.${extension.replace(/^\.+/, "")}`;
}

export async function exportTextArtifact(options: {
  filename: string;
  text: string;
  mimeType?: string;
}): Promise<TextExportResult> {
  const { filename, text, mimeType = "text/plain;charset=utf-8" } = options;
  if (isTauriAvailable()) {
    // The app writes it (src-tauri/src/downloads.rs): the OS Downloads folder (on Linux
    // XDG_DOWNLOAD_DIR, which may not be ~/Downloads), else ~/Downloads, created if missing.
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string>("save_download", { filename, contents: text });
    return { method: "tauri-download", path, pathHint: path };
  }

  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("Text export requires a browser or desktop runtime.");
  }

  const blob = new Blob([text], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return {
    method: "browser-download",
    path: filename,
    pathHint: `${DOWNLOADS_PATH_PREFIX}/${filename}`,
  };
}

// Status cells in the lists carry a decorative emoji ("🏃Running", "⚠️Critical"). A quoted cell
// that starts with pictographs loses them, so the file holds the plain value; emoji inside the
// text stay. Every CSV here quotes each cell, so a cell start is a quote at a line start or
// after a comma (an escaped quote inside a cell is doubled and never matches).
const LEADING_CELL_EMOJI = /(^|,)"(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D})+/gmu;

export function plainCsvCells(csv: string): string {
  return csv.replace(LEADING_CELL_EMOJI, '$1"');
}

export async function exportCsvArtifact(options: {
  filename: string;
  csv: string;
}): Promise<TextExportResult> {
  const { filename, csv } = options;
  return exportTextArtifact({
    filename,
    text: `\uFEFF${plainCsvCells(csv)}`,
    mimeType: "text/csv;charset=utf-8;",
  });
}
