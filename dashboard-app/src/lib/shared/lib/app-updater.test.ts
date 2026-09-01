import { describe, expect, it, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  appNotifications,
  dismissAllNotifications,
  clearDismissedNotifications,
} from "./app-notifications";
import { checkForUpdateSilently } from "./app-updater";

const askMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock("./tauri-runtime", () => ({
  isTauriAvailable: () => false,
  safeDialogAsk: askMock,
}));

function makePort(overrides: {
  update?: { version: string; downloadAndInstall: () => Promise<void> } | null;
  checkError?: Error;
}) {
  const relaunch = vi.fn(async () => {});
  const check = vi.fn(async () => {
    if (overrides.checkError) throw overrides.checkError;
    return overrides.update ?? null;
  });
  return { port: { check, relaunch }, check, relaunch };
}

describe("app-updater", () => {
  beforeEach(() => {
    dismissAllNotifications();
    clearDismissedNotifications();
    askMock.mockReset();
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does nothing outside the desktop runtime", async () => {
    await checkForUpdateSilently();
    expect(get(appNotifications)).toHaveLength(0);
  });

  it("stays silent when there is no update", async () => {
    const { port, check } = makePort({ update: null });
    await checkForUpdateSilently(port);
    expect(check).toHaveBeenCalledTimes(1);
    expect(get(appNotifications)).toHaveLength(0);
  });

  it("stays silent when the check itself fails (offline, deb/rpm install)", async () => {
    const { port } = makePort({ checkError: new Error("Unsupported Linux package") });
    await checkForUpdateSilently(port);
    expect(get(appNotifications)).toHaveLength(0);
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
});
