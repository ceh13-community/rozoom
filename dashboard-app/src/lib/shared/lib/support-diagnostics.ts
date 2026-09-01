import { isTauriAvailable } from "./tauri-runtime";
import { redactSecrets } from "./log-redaction";

/**
 * "Copy details for support" (spec update-2-crash-log-path.md, path A):
 * error message + timestamp + app version + redacted tail of the log file,
 * in one clipboard write. Everything that can fail degrades to a shorter
 * report - the button must always produce something pasteable.
 */

export const SUPPORT_LOG_TAIL_LINES = 200;

export interface SupportReportInput {
  message: string;
  status?: number;
  route?: string;
  appVersion: string;
  now?: Date;
  logTail: string;
}

export function buildSupportReport(input: SupportReportInput): string {
  const when = (input.now ?? new Date()).toISOString();
  const header = [
    "Rozoom support details",
    `Version: ${input.appVersion}`,
    `Time: ${when}`,
    input.route ? `Route: ${input.route}` : null,
    input.status !== undefined ? `Status: ${input.status}` : null,
    `Error: ${redactSecrets(input.message || "unknown error")}`,
  ].filter((line): line is string => line !== null);

  const tail = redactSecrets(input.logTail).trim();
  const body = tail
    ? [`--- last ${SUPPORT_LOG_TAIL_LINES} log lines (secrets redacted) ---`, tail]
    : ["--- no log file yet ---"];

  return [...header, "", ...body].join("\n");
}

export async function readRecentLogTail(maxLines = SUPPORT_LOG_TAIL_LINES): Promise<string> {
  if (!isTauriAvailable()) return "";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_recent_log_tail", { maxLines });
  } catch (error) {
    return `[log file unavailable: ${String(error)}]`;
  }
}

export async function openLogsFolder(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_logs_folder");
}

export async function getLogsFolderPath(): Promise<string | null> {
  if (!isTauriAvailable()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("logs_folder_path");
  } catch {
    return null;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
