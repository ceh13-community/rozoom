import { describe, expect, it, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  appNotifications,
  dismissAllNotifications,
  clearDismissedNotifications,
  dismissNotification,
  markAsRead,
} from "./app-notifications";
import { checkForUpdateSilently, type LinuxPackageKind } from "./app-updater";

const askMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
const appLogMock = vi.hoisted(() =>
  vi.fn<(level: "info" | "warn" | "error", message: string) => Promise<void>>(async () => {}),
);
const openExternalMock = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>(async () => {}));

vi.mock("./tauri-runtime", () => ({
  isTauriAvailable: () => false,
  safeDialogAsk: askMock,
  safeAppLog: appLogMock,
}));

vi.mock("../api/in-app-browser", () => ({
  openExternalUrl: openExternalMock,
}));

function makePort(overrides: {
  update?: { version: string; downloadAndInstall: () => Promise<void> } | null;
  checkError?: Error;
  /** `null` (default) = macOS/Windows; a kind = Linux package install. */
  linuxPackageKind?: LinuxPackageKind | null;
}) {
  const relaunch = vi.fn(async () => {});
  const check = vi.fn(async (_options?: { target: string }) => {
    if (overrides.checkError) throw overrides.checkError;
    return overrides.update ?? null;
  });
  const linuxPackageKind = vi.fn(async () => overrides.linuxPackageKind ?? null);
  return { port: { check, relaunch, linuxPackageKind }, check, relaunch, linuxPackageKind };
}

function linuxPort(kind: LinuxPackageKind, version = "0.26.3") {
  const downloadAndInstall = vi.fn(async () => {});
  const made = makePort({ update: { version, downloadAndInstall }, linuxPackageKind: kind });
  return { ...made, downloadAndInstall };
}

describe("app-updater", () => {
  beforeEach(() => {
    dismissAllNotifications();
    clearDismissedNotifications();
    askMock.mockReset();
    appLogMock.mockClear();
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does nothing outside the desktop runtime", async () => {
    await checkForUpdateSilently();
    expect(get(appNotifications)).toHaveLength(0);
  });

  it("stays silent when there is no update, but records the check in the app log", async () => {
    const { port, check } = makePort({ update: null });
    await checkForUpdateSilently(port);
    expect(check).toHaveBeenCalledTimes(1);
    expect(get(appNotifications)).toHaveLength(0);
    expect(appLogMock).toHaveBeenCalledWith("info", expect.stringContaining("up to date"));
  });

  it("stays silent when the check itself fails (offline, deb/rpm install)", async () => {
    const { port } = makePort({ checkError: new Error("Unsupported Linux package") });
    await checkForUpdateSilently(port);
    expect(get(appNotifications)).toHaveLength(0);
    expect(appLogMock).toHaveBeenCalledWith("warn", expect.stringContaining("check failed on v"));
    expect(appLogMock).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("Unsupported Linux package"),
    );
  });

  it("downloads silently and posts one unread 'ready' notification with a restart action", async () => {
    const downloadAndInstall = vi.fn(async () => {});
    const { port, relaunch } = makePort({
      update: { version: "0.23.0", downloadAndInstall },
    });

    await checkForUpdateSilently(port);

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    const list = get(appNotifications);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      severity: "info",
      category: "update",
      title: "Rozoom 0.23.0 is ready",
      detail: "Restart to finish updating.",
    });
    expect(list[0].readAt).toBeUndefined();
    expect(list[0].action?.label).toBe("Restart now");
    expect(appLogMock).toHaveBeenCalledWith("info", expect.stringContaining("v0.23.0 available"));
    expect(appLogMock).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("v0.23.0 downloaded and staged"),
    );

    askMock.mockResolvedValueOnce(false);
    await list[0].action?.run();
    expect(relaunch).not.toHaveBeenCalled();

    askMock.mockResolvedValueOnce(true);
    await list[0].action?.run();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("turns the same item into a warning with Retry when download fails, then recovers", async () => {
    const downloadAndInstall = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const { port } = makePort({ update: { version: "0.23.0", downloadAndInstall } });

    await checkForUpdateSilently(port);

    let list = get(appNotifications);
    expect(list).toHaveLength(1);
    expect(list[0].severity).toBe("warning");
    expect(list[0].title).toBe("Update failed");
    expect(list[0].detail).toContain("nothing broke");
    expect(list[0].action?.label).toBe("Retry");
    expect(appLogMock).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("download/install of v0.23.0 failed: network"),
    );

    await list[0].action?.run();

    list = get(appNotifications);
    expect(list).toHaveLength(1);
    expect(list[0].severity).toBe("info");
    expect(list[0].title).toBe("Rozoom 0.23.0 is ready");
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent checks into one cycle", async () => {
    const { port, check } = makePort({ update: null });
    await Promise.all([checkForUpdateSilently(port), checkForUpdateSilently(port)]);
    expect(check).toHaveBeenCalledTimes(1);
  });

  describe("Linux package installs: announce only, never download", () => {
    beforeEach(() => {
      window.localStorage.clear();
      openExternalMock.mockClear();
    });

    it("reads the -deb key, posts one unread notice with the release link and downloads nothing", async () => {
      const { port, check, downloadAndInstall } = linuxPort("deb");

      await checkForUpdateSilently(port);

      expect(check).toHaveBeenCalledWith({ target: "linux-x86_64-deb" });
      expect(downloadAndInstall).not.toHaveBeenCalled();
      const list = get(appNotifications);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        severity: "info",
        category: "update",
        title: "Rozoom 0.26.3 is available",
        detail:
          "Rozoom doesn't update itself on Linux. Download the new .deb from the release page and install it the way you installed this one.",
      });
      expect(list[0].readAt).toBeUndefined();
      expect(list[0].action?.label).toBe("Open release page");
      expect(appLogMock).toHaveBeenCalledWith(
        "info",
        expect.stringContaining("Linux deb install: notice only, no download"),
      );

      await list[0].action?.run();
      expect(openExternalMock).toHaveBeenCalledWith(
        "https://github.com/ceh13-community/rozoom/releases/tag/app-v0.26.3",
      );
      expect(window.localStorage.getItem("rozoom.update_notice_seen")).toBe("0.26.3");
    });

    it("reads the -rpm key and names the .rpm", async () => {
      const { port, check } = linuxPort("rpm");
      await checkForUpdateSilently(port);
      expect(check).toHaveBeenCalledWith({ target: "linux-x86_64-rpm" });
      expect(get(appNotifications)[0].detail).toContain(
        "Download the new .rpm from the release page",
      );
    });

    it("falls back to the -deb key and generic wording when the package kind is unknown", async () => {
      const { port, check } = linuxPort("unknown");
      await checkForUpdateSilently(port);
      expect(check).toHaveBeenCalledWith({ target: "linux-x86_64-deb" });
      expect(get(appNotifications)[0].detail).toContain(
        "Download the new package from the release page",
      );
    });

    it("stays quiet when the manifest has no newer version for the key", async () => {
      const { port } = makePort({ update: null, linuxPackageKind: "deb" });
      await checkForUpdateSilently(port);
      expect(get(appNotifications)).toHaveLength(0);
      expect(appLogMock).toHaveBeenCalledWith(
        "info",
        expect.stringContaining("up to date (linux-x86_64-deb)"),
      );
    });

    it("does not repeat a notice the user already read, but shows a newer version", async () => {
      const first = linuxPort("deb", "0.26.3");
      await checkForUpdateSilently(first.port);
      const [notice] = get(appNotifications);
      markAsRead(notice.id);
      expect(window.localStorage.getItem("rozoom.update_notice_seen")).toBe("0.26.3");

      dismissAllNotifications();
      clearDismissedNotifications();
      const again = linuxPort("deb", "0.26.3");
      await checkForUpdateSilently(again.port);
      expect(get(appNotifications)).toHaveLength(0);
      expect(appLogMock).toHaveBeenCalledWith(
        "info",
        expect.stringContaining("notice already seen, not repeated"),
      );

      const newer = linuxPort("deb", "0.27.0");
      await checkForUpdateSilently(newer.port);
      expect(get(appNotifications)).toHaveLength(1);
      expect(get(appNotifications)[0].title).toBe("Rozoom 0.27.0 is available");
    });

    it("records a dismissed notice as seen", async () => {
      const { port } = linuxPort("deb", "0.26.3");
      await checkForUpdateSilently(port);
      dismissNotification(get(appNotifications)[0].id);
      expect(window.localStorage.getItem("rozoom.update_notice_seen")).toBe("0.26.3");
    });

    it("treats a failed probe on a Linux desktop as an unknown package: announce only", async () => {
      // jsdom reports a Linux user agent.
      expect(navigator.userAgent).toMatch(/linux/i);
      const downloadAndInstall = vi.fn(async () => {});
      const { port, check } = makePort({ update: { version: "0.26.3", downloadAndInstall } });
      port.linuxPackageKind.mockRejectedValueOnce(new Error("no such command"));
      await checkForUpdateSilently(port);
      expect(check).toHaveBeenCalledWith({ target: "linux-x86_64-deb" });
      expect(downloadAndInstall).not.toHaveBeenCalled();
      expect(get(appNotifications)[0].detail).toContain(
        "Download the new package from the release page",
      );
    });

    it("runs the regular download flow when the probe fails off Linux", async () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
        configurable: true,
      });
      try {
        const downloadAndInstall = vi.fn(async () => {});
        const { port, check } = makePort({ update: { version: "0.26.3", downloadAndInstall } });
        port.linuxPackageKind.mockRejectedValueOnce(new Error("no such command"));
        await checkForUpdateSilently(port);
        expect(check).toHaveBeenCalledWith();
        expect(downloadAndInstall).toHaveBeenCalledTimes(1);
      } finally {
        delete (navigator as { userAgent?: string }).userAgent;
      }
      expect(navigator.userAgent).toMatch(/linux/i);
    });
  });
});
