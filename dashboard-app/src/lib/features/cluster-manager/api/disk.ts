import * as Sentry from "@sentry/sveltekit";
import { error } from "@tauri-apps/plugin-log";
import { path } from "@tauri-apps/api";
import {
  exists,
  writeTextFile,
  BaseDirectory,
  mkdir,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";

import { CONFIG_DIR } from "$entities/config/";

async function ensureConfigDirExists(): Promise<void> {
  const dirExists = await configExists();

  if (!dirExists) {
    await mkdir(CONFIG_DIR, {
      recursive: true,
      baseDir: BaseDirectory.AppData,
    });
  }
}

export async function configExists(): Promise<boolean> {
  return await exists(CONFIG_DIR, { baseDir: BaseDirectory.AppData });
}

export async function saveClusterOnDisk(uuid: string, data: string): Promise<void> {
  try {
    await ensureConfigDirExists();
    await writeTextFile(`${CONFIG_DIR}/${uuid}.yaml`, data, {
      baseDir: BaseDirectory.AppData,
    });
  } catch (err) {
    await error(err instanceof Error ? err.message : String(err));
    Sentry.captureException(err);
  }
}

export async function saveKubeConfig(raw: string): Promise<string | undefined> {
  try {
    const home = await path.appDataDir();
    await ensureConfigDirExists();
    await writeTextFile(`${CONFIG_DIR}/kubeconfig.yaml`, raw, {
      baseDir: BaseDirectory.AppData,
    });

    return await path.join(home, `${CONFIG_DIR}/kubeconfig.yaml`);
  } catch (err) {
    await error(err instanceof Error ? err.message : String(err));
    Sentry.captureException(err);
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
