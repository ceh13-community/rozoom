import { beforeEach, describe, expect, it, vi } from "vitest";

const appLog = vi.fn();
vi.mock("./tauri-runtime", () => ({
  safeAppLog: (level: string, message: string) => {
    appLog(level, message);
    return Promise.resolve();
  },
}));

import {
  logDataMode,
  logPollSchedule,
  logPollStopped,
  logWatchState,
  resetSyncLogForTests,
} from "./sync-log";

const lines = () => appLog.mock.calls.map(([, message]) => message as string);

describe("sync lines", () => {
  beforeEach(() => {
    appLog.mockClear();
    resetSyncLogForTests();
  });

  it("writes a watch line only when the transport or liveness changes", () => {
    logWatchState("pod", "c1", { transport: "api", live: false, error: null });
    logWatchState("pod", "c1", { transport: "api", live: false, error: null });
    logWatchState("pod", "c1", { transport: "api", live: true, error: null });
    logWatchState("pod", "c1", { transport: "api", live: true, error: null });
    logWatchState("pod", "c1", {
      transport: "fallback",
      live: false,
      error: "API watch failed: 403 Forbidden\nstack",
    });
    logWatchState("pod", "c1", { transport: "idle", live: false, error: null });
    expect(lines()).toEqual([
      "[sync] pod cluster=c1 watch=api live=no",
      "[sync] pod cluster=c1 watch=api live=yes",
      '[sync] pod cluster=c1 watch=kubectl live=no error="API watch failed: 403 Forbidden"',
      "[sync] pod cluster=c1 watch=off",
    ]);
  });

  it("keeps clusters and kinds apart", () => {
    logWatchState("pod", "c1", { transport: "api", live: true, error: null });
    logWatchState("pod", "c2", { transport: "api", live: true, error: null });
    logWatchState("deployment", "c1", { transport: "api", live: true, error: null });
    expect(lines()).toHaveLength(3);
  });

  it("writes poll lines on start, interval change and stop", () => {
    logPollStopped("deployments");
    logPollSchedule("deployments", 30, 0);
    logPollSchedule("deployments", 30, 0);
    logPollSchedule("deployments", 60, 2);
    logPollStopped("deployments");
    logPollStopped("deployments");
    expect(lines()).toEqual([
      "[sync] deployments poll every 30s",
      "[sync] deployments poll every 60s (backoff after 2 failed)",
      "[sync] deployments poll stopped",
    ]);
  });

  it("writes the data mode when it changes", () => {
    logDataMode("Balanced", "Balanced");
    logDataMode("Fast LAN", "Balanced");
    expect(lines()).toEqual(["[sync] data mode Fast LAN (was Balanced)"]);
  });
});
