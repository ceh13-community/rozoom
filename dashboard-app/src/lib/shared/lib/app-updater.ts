import { isTauriAvailable, safeAppLog, safeDialogAsk } from "./tauri-runtime";
import { appNotifications, pushNotification } from "./app-notifications";
import { openExternalUrl } from "../api/in-app-browser";

/**
 * In-app update flow (Sprint 19, spec update-1-notify-restart-flow.md):
 * silent check on launch -> silent background download -> one unread bell
 * notification with an inline "Restart now" action -> native confirm before
 * restart (the only confirmation in the whole flow). Any failure keeps the
 * running version and turns the same notification into a warning with Retry.
 *
 * Linux (.deb, .rpm) is announce-only (card Y1zBb4Xz, PO decision 05/11/2026,
 * copy 9C9QRLwu v2). The updater plugin can replace a package only through
 * pkexec, and the app never asks for a password. The launch check reads the
 * per-package manifest key (linux-x86_64-deb or linux-x86_64-rpm, written by
 * tauri-action and by the slim job; ignored by every client up to 0.26.1) and
 * posts one unread notice per version with a link to that release's page.
 * Nothing is downloaded. A notice that was read, dismissed or acted on does
 * not come back for that version (localStorage); a newer version replaces it.
 * The bare linux-x86_64 key is removed at release time
 * (scripts/finalize-release-asset-names.sh): it drove the old clients into
 * pkexec, a failed .rpm write or an overwritten AppImage.
 */

const UPDATE_DEDUPE_KEY = "app-update";
const LINUX_NOTICE_SEEN_KEY = "rozoom.update_notice_seen";
const RELEASE_PAGE_PREFIX = "https://github.com/ceh13-community/rozoom/releases/tag/app-v";

/** How the running binary was installed on Linux; `unknown` for an extracted package or a build tree. */
export type LinuxPackageKind = "deb" | "rpm" | "unknown";

type UpdateHandle = {
  version: string;
  downloadAndInstall: () => Promise<void>;
};

export type UpdaterPort = {
  /** `target` selects the manifest key; without it the plugin derives `<os>-<arch>`. */
  check: (options?: { target: string }) => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
  /** `null` off Linux; on Linux the package kind the binary came from. */
  linuxPackageKind: () => Promise<LinuxPackageKind | null>;
};

async function loadTauriUpdater(): Promise<UpdaterPort> {
  const [{ check }, { relaunch }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
    import("@tauri-apps/api/core"),
  ]);
  return {
    check: async (options) => {
      const update = await check(options);
      if (!update) return null;
      return {
        version: update.version,
        downloadAndInstall: () => update.downloadAndInstall(),
      };
    },
    relaunch,
    linuxPackageKind: () => invoke<LinuxPackageKind | null>("linux_package_kind"),
  };
}

let inFlight: Promise<void> | null = null;

/**
 * Silent launch-time check. Never throws, never shows UI unless an update was
 * actually downloaded (macOS, Windows) or a new release exists for a Linux
 * package install. A failed check (offline, GitHub down, no entry for this
 * platform) is logged and otherwise ignored - it is not the user's problem.
 */
export function checkForUpdateSilently(port?: UpdaterPort): Promise<void> {
  if (!port && !isTauriAvailable()) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = runUpdateCycle(port).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runUpdateCycle(port?: UpdaterPort): Promise<void> {
  let updater: UpdaterPort;
  try {
    updater = port ?? (await loadTauriUpdater());
  } catch (error) {
    console.debug("[updater] check skipped:", error);
    await safeAppLog(
      "warn",
      `[updater] check failed on v${__APP_VERSION__}: ${describeError(error)}`,
    );
    return;
  }

  const packageKind = await detectLinuxPackageKind(updater);
  if (packageKind !== null) {
    await announceLinuxRelease(updater, packageKind);
    return;
  }

  let update: UpdateHandle | null;
  try {
    update = await updater.check();
  } catch (error) {
    console.debug("[updater] check skipped:", error);
    await safeAppLog(
      "warn",
      `[updater] check failed on v${__APP_VERSION__}: ${describeError(error)}`,
    );
    return;
  }
  if (!update) {
    await safeAppLog("info", `[updater] check ok: v${__APP_VERSION__} is up to date`);
    return;
  }
  await safeAppLog(
    "info",
    `[updater] check ok: v${update.version} available (running v${__APP_VERSION__}), downloading`,
  );
  await downloadAndNotify(updater, update);
}

/** A failed probe counts as "not a Linux package": the regular flow then fails or succeeds as before. */
async function detectLinuxPackageKind(updater: UpdaterPort): Promise<LinuxPackageKind | null> {
  try {
    return await updater.linuxPackageKind();
  } catch (error) {
    console.debug("[updater] package kind unavailable:", error);
    return null;
  }
}

/** Manifest key for a Linux install. Only x86_64 Linux packages are published. */
export function linuxManifestTarget(kind: LinuxPackageKind): string {
  return kind === "rpm" ? "linux-x86_64-rpm" : "linux-x86_64-deb";
}

/** Notice copy, 9C9QRLwu v2: names the package type when it is known. */
export function linuxNoticeDetail(kind: LinuxPackageKind): string {
  const what =
    kind === "deb" ? "the new .deb" : kind === "rpm" ? "the new .rpm" : "the new package";
  return `Rozoom doesn't update itself on Linux. Download ${what} from the release page and install it the way you installed this one.`;
}

export function releasePageUrl(version: string): string {
  return `${RELEASE_PAGE_PREFIX}${version}`;
}

async function announceLinuxRelease(updater: UpdaterPort, kind: LinuxPackageKind): Promise<void> {
  const target = linuxManifestTarget(kind);
  let update: UpdateHandle | null;
  try {
    update = await updater.check({ target });
  } catch (error) {
    console.debug("[updater] check skipped:", error);
    await safeAppLog(
      "warn",
      `[updater] check failed on v${__APP_VERSION__} (${target}): ${describeError(error)}`,
    );
    return;
  }
  if (!update) {
    await safeAppLog("info", `[updater] check ok: v${__APP_VERSION__} is up to date (${target})`);
    return;
  }
  if (readSeenVersion() === update.version) {
    await safeAppLog(
      "info",
      `[updater] v${update.version} available (${target}); notice already seen, not repeated`,
    );
    return;
  }
  await safeAppLog(
    "info",
    `[updater] v${update.version} available (running v${__APP_VERSION__}, ${target}); Linux ${kind} install: notice only, no download`,
  );
  const version = update.version;
  pushNotification({
    severity: "info",
    category: "update",
    title: `Rozoom ${version} is available`,
    detail: linuxNoticeDetail(kind),
    dedupeKey: UPDATE_DEDUPE_KEY,
    action: {
      label: "Open release page",
      run: async () => {
        rememberSeenVersion(version);
        await openExternalUrl(releasePageUrl(version));
      },
    },
  });
  rememberWhenHandled(version);
}

/**
 * Once the notice is read (opened, "Mark all read") or dismissed, the version is
 * recorded so the next launch stays quiet. The store calls back synchronously on
 * subscribe with the unread notice just pushed, so the early return runs first
 * and `unsubscribe` is assigned by the time a later change settles it.
 */
function rememberWhenHandled(version: string): void {
  const unsubscribe = appNotifications.subscribe((list) => {
    const notice = list.find((n) => n.dedupeKey === UPDATE_DEDUPE_KEY);
    if (notice && !notice.readAt) return; // still unread and visible
    rememberSeenVersion(version);
    queueMicrotask(() => {
      unsubscribe();
    });
  });
}

function readSeenVersion(): string | null {
  try {
    return globalThis.localStorage.getItem(LINUX_NOTICE_SEEN_KEY);
  } catch {
    return null; // no storage in this runtime: behave as if nothing was seen
  }
}

function rememberSeenVersion(version: string): void {
  try {
    globalThis.localStorage.setItem(LINUX_NOTICE_SEEN_KEY, version);
  } catch {
    // Storage unavailable: the notice may show again next launch, nothing else.
  }
}

async function downloadAndNotify(updater: UpdaterPort, update: UpdateHandle): Promise<void> {
  try {
    await update.downloadAndInstall();
  } catch (error) {
    console.warn("[updater] download failed:", error);
    await safeAppLog(
      "error",
      `[updater] download/install of v${update.version} failed: ${describeError(error)}`,
    );
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

  await safeAppLog(
    "info",
    `[updater] v${update.version} downloaded and staged, waiting for restart`,
  );
  pushNotification({
    severity: "info",
    category: "update",
    title: `Rozoom ${update.version} is ready`,
    // Fixed copy on purpose (Sara, 01/09): latest.json `notes` carries the
    // CI-generated release body (artifact table + internal draft disclaimer),
    // which must never reach the bell. Per-release "what's new" is Sprint 20.
    detail: "Restart to finish updating.",
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
  await safeAppLog("info", "[updater] restarting to apply the staged update");
  await updater.relaunch();
}
