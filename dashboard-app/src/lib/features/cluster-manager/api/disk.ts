import * as Sentry from "@sentry/sveltekit";
import { error } from "@tauri-apps/plugin-log";
import { path } from "@tauri-apps/api";
import { exists, BaseDirectory, readTextFile, remove } from "@tauri-apps/plugin-fs";

import { CONFIG_DIR } from "$entities/config/";
import { mkdirPrivate, writePrivateTextFile } from "$shared/lib/private-files";

const PASTED_KUBECONFIG = `${CONFIG_DIR}/kubeconfig.yaml`;

// Everything under configs/ carries credentials (flattened kubeconfigs embed tokens
// and client keys), so the directory is 0700 and every file 0600.
async function ensureConfigDirExists(): Promise<void> {
  const dirExists = await configExists();

  if (!dirExists) {
    await mkdirPrivate(CONFIG_DIR, BaseDirectory.AppData);
  }
}

export async function configExists(): Promise<boolean> {
  return await exists(CONFIG_DIR, { baseDir: BaseDirectory.AppData });
}

export async function saveClusterOnDisk(uuid: string, data: string): Promise<void> {
  try {
    await ensureConfigDirExists();
    await writePrivateTextFile(`${CONFIG_DIR}/${uuid}.yaml`, data, BaseDirectory.AppData);
  } catch (err) {
    await error(err instanceof Error ? err.message : String(err));
    Sentry.captureException(err);
  }
}

/**
 * Stores a pasted or uploaded kubeconfig so kubectl can flatten each context out of it.
 * Callers remove it with removePastedKubeConfig once the import is over: the per-cluster
 * files are the copies the app keeps, this one would only be a second copy of every token.
 */
export async function saveKubeConfig(raw: string): Promise<string | undefined> {
  try {
    const home = await path.appDataDir();
    await ensureConfigDirExists();
    await writePrivateTextFile(PASTED_KUBECONFIG, raw, BaseDirectory.AppData);

    return await path.join(home, PASTED_KUBECONFIG);
  } catch (err) {
    await error(err instanceof Error ? err.message : String(err));
    Sentry.captureException(err);
  }
}

export async function removePastedKubeConfig(): Promise<void> {
  try {
    if (await exists(PASTED_KUBECONFIG, { baseDir: BaseDirectory.AppData })) {
      await remove(PASTED_KUBECONFIG, { baseDir: BaseDirectory.AppData });
    }
  } catch (err) {
    await error(err instanceof Error ? err.message : String(err));
  }
}

export async function getClusterFromDisk(uuid: string): Promise<string | null> {
  const fileExists = await exists(`${CONFIG_DIR}/${uuid}.yaml`, {
    baseDir: BaseDirectory.AppData,
  });

  if (!fileExists) return null;

  return await readTextFile(`${CONFIG_DIR}/${uuid}.yaml`, {
    baseDir: BaseDirectory.AppData,
  });
}

export async function removeClusterFromDisk(uuid: string): Promise<void> {
  await remove(`${CONFIG_DIR}/${uuid}.yaml`, {
    baseDir: BaseDirectory.AppData,
  });
}
