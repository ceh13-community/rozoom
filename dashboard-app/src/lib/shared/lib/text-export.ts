import { isTauriAvailable } from "./tauri-runtime";

export type TextExportResult = {
  method: "tauri-download" | "browser-download";
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
    const { BaseDirectory, writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(filename, text, { baseDir: BaseDirectory.Download });
    return {
      method: "tauri-download",
      pathHint: `${DOWNLOADS_PATH_PREFIX}/${filename}`,
    };
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
    pathHint: `${DOWNLOADS_PATH_PREFIX}/${filename}`,
  };
}

export async function exportCsvArtifact(options: {
  filename: string;
  csv: string;
}): Promise<TextExportResult> {
  const { filename, csv } = options;
  return exportTextArtifact({
    filename,
    text: `\uFEFF${csv}`,
    mimeType: "text/csv;charset=utf-8;",
  });
}
