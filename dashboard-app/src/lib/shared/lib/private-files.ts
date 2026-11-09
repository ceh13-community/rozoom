import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Files the app writes that hold credentials: flattened kubeconfigs (tokens, client keys),
 * the pasted kubeconfig, connection-test copies, Velero install profiles, helm values and
 * restore YAML. They are created owner-only. The Tauri fs plugin otherwise leaves the mode
 * to the umask, which on this class of hosts means 664 / 775 (reviewer finding 3, GKFjp7g8).
 *
 * `mode` applies when a file or directory is created; files that already exist keep their
 * mode, so `hardenPrivateFiles` runs once per launch to fix those in place.
 */
export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

export async function mkdirPrivate(path: string, baseDir?: BaseDirectory): Promise<void> {
  await mkdir(path, {
    recursive: true,
    mode: PRIVATE_DIR_MODE,
    ...(baseDir !== undefined ? { baseDir } : {}),
  });
}

export async function writePrivateTextFile(
  path: string,
  data: string,
  baseDir?: BaseDirectory,
): Promise<void> {
  await writeTextFile(path, data, {
    mode: PRIVATE_FILE_MODE,
    ...(baseDir !== undefined ? { baseDir } : {}),
  });
}

export type HardenReport = {
  /** Directories whose mode was changed. */
  dirsFixed: number;
  /** Files whose mode was changed. */
  filesFixed: number;
  /** Paths that could not be changed, with the OS error. */
  errors: string[];
};

/**
 * Sets 0700 on the app's private directories and 0600 on every file inside them. Runs in
 * Rust (`harden_private_files`), no-op on Windows. Never throws; returns null when the
 * desktop runtime is not there (browser preview, tests).
 */
export async function hardenPrivateFiles(): Promise<HardenReport | null> {
  try {
    return await invoke<HardenReport>("harden_private_files");
  } catch {
    return null;
  }
}
