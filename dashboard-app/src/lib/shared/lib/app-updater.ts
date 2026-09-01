import { isTauriAvailable, safeDialogAsk } from "./tauri-runtime";
import { pushNotification } from "./app-notifications";

/**
 * In-app update flow (Sprint 19, spec update-1-notify-restart-flow.md):
 * silent check on launch -> silent background download -> one unread bell
 * notification with an inline "Restart now" action -> native confirm before
 * restart (the only confirmation in the whole flow). Any failure keeps the
 * running version and turns the same notification into a warning with Retry.
 */

const UPDATE_DEDUPE_KEY = "app-update";

type UpdateHandle = {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
};

type UpdaterPort = {
  check: () => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
};

async function loadTauriUpdater(): Promise<UpdaterPort> {
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  return {
    check: async () => {
      const update = await check();
      if (!update) return null;
      return {
        version: update.version,
        body: update.body ?? undefined,
        downloadAndInstall: () => update.downloadAndInstall(),
      };
    },
    relaunch,
  };
}

let inFlight: Promise<void> | null = null;

/**
 * Silent launch-time check. Never throws, never shows UI unless an update was
 * actually downloaded. A failed check (offline, deb/rpm install where Tauri
 * only supports AppImage, GitHub down) is logged and otherwise ignored - it is
 * not the user's problem.
 */
export function checkForUpdateSilently(port?: UpdaterPort): Promise<void> {
  if (!port && !isTauriAvailable()) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = runUpdateCycle(port).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runUpdateCycle(port?: UpdaterPort): Promise<void> {
  let updater: UpdaterPort;
  let update: UpdateHandle | null;
  try {
    updater = port ?? (await loadTauriUpdater());
    update = await updater.check();
  } catch (error) {
    console.debug("[updater] check skipped:", error);
    return;
  }
  if (!update) return;
  await downloadAndNotify(updater, update);
}

async function downloadAndNotify(updater: UpdaterPort, update: UpdateHandle): Promise<void> {
  try {
    await update.downloadAndInstall();
  } catch (error) {
    console.warn("[updater] download failed:", error);
    pushNotification({
      severity: "warning",
      category: "update",
      title: "Update failed",
      detail: `Rozoom couldn't finish downloading the update. Still on v${__APP_VERSION__} - nothing broke.`,
      dedupeKey: UPDATE_DEDUPE_KEY,
      action: { label: "Retry", run: () => downloadAndNotify(updater, update) },
    });
    return;
  }

  pushNotification({
    severity: "info",
    category: "update",
    title: `Rozoom ${update.version} is ready`,
    detail: update.body?.trim() || "Restart to finish updating.",
    dedupeKey: UPDATE_DEDUPE_KEY,
    action: { label: "Restart now", run: () => confirmAndRestart(updater) },
  });
}

async function confirmAndRestart(updater: UpdaterPort): Promise<void> {
  const ok = await safeDialogAsk("Restart to update? Any open exec sessions will close.", {
    title: "Restart Rozoom",
    kind: "info",
  });
  if (!ok) return;
  await updater.relaunch();
}
