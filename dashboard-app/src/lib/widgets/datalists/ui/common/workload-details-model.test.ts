import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTrailingThrottle,
  isLiveItemGone,
  shouldReloadForTerminating,
  mapWorkloadPods,
  parseTopPods,
  pickLiveItem,
  toLabelSelectorArg,
  workloadPodsSelector,
} from "./workload-details-model";

describe("pickLiveItem", () => {
  const opened = { metadata: { name: "db", namespace: "shop", resourceVersion: "1" }, ready: 0 };

  it("returns the list's newer copy of the open object", () => {
    const live = { metadata: { name: "db", namespace: "shop", resourceVersion: "2" }, ready: 2 };
    const other = { metadata: { name: "db", namespace: "other", resourceVersion: "9" }, ready: 1 };
    expect(pickLiveItem(opened, [other, live])).toBe(live);
  });

  it("returns null when nothing changed or the object is gone", () => {
    const same = { metadata: { name: "db", namespace: "shop", resourceVersion: "1" }, ready: 0 };
    expect(pickLiveItem(opened, [same])).toBeNull();
    expect(pickLiveItem(opened, [])).toBeNull();
    expect(pickLiveItem(null, [same])).toBeNull();
  });
});

describe("pods of a workload", () => {
  it("uses the label selector, expressions included", () => {
    expect(
      toLabelSelectorArg({
        matchLabels: { app: "db" },
        matchExpressions: [
          { key: "tier", operator: "In", values: ["a", "b"] },
          { key: "canary", operator: "DoesNotExist" },
        ],
      }),
    ).toBe("app=db,tier in (a,b),!canary");
    expect(toLabelSelectorArg({})).toBeNull();
  });

  it("finds a CronJob's pods through its running Jobs", () => {
    expect(
      workloadPodsSelector({ status: { active: [{ name: "backup-1" }, { name: "backup-2" }] } }),
    ).toBe("job-name in (backup-1,backup-2)");
    expect(workloadPodsSelector({ status: {} })).toBeNull();
    expect(workloadPodsSelector({ spec: { selector: { matchLabels: { app: "db" } } } })).toBe(
      "app=db",
    );
  });

  it("maps kubectl get pods and top into rows", () => {
    const pods = JSON.stringify({
      items: [
        {
          metadata: { name: "db-0", namespace: "shop" },
          spec: { nodeName: "n1" },
          status: { phase: "Running", containerStatuses: [{ ready: true }, { ready: false }] },
        },
        {
          metadata: { name: "db-1", namespace: "shop" },
          status: {
            phase: "Pending",
            containerStatuses: [
              { ready: false, state: { waiting: { reason: "ImagePullBackOff" } } },
            ],
          },
        },
      ],
    });
    const rows = mapWorkloadPods(pods, "shop", parseTopPods("db-0   5m   12Mi\n"));
    expect(rows).toEqual([
      {
        name: "db-0",
        node: "n1",
        namespace: "shop",
        ready: "1 / 2",
        cpu: "5m",
        memory: "12Mi",
        status: "Running",
      },
      {
        name: "db-1",
        node: "-",
        namespace: "shop",
        ready: "0 / 1",
        cpu: "-",
        memory: "-",
        status: "ImagePullBackOff",
      },
    ]);
  });
});

describe("isLiveItemGone", () => {
  const open = { metadata: { name: "db", namespace: "shop" } };

  it("is true only when a loaded list no longer has the object", () => {
    expect(isLiveItemGone(open, [{ metadata: { name: "web", namespace: "shop" } }])).toBe(true);
    expect(isLiveItemGone(open, [{ metadata: { name: "db", namespace: "shop" } }])).toBe(false);
    expect(isLiveItemGone(open, [])).toBe(false);
    expect(isLiveItemGone(null, [{ metadata: { name: "web", namespace: "shop" } }])).toBe(false);
  });
});

describe("createTrailingThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("10 changes in a second after the open load run the load at most twice in all", () => {
    const run = vi.fn();
    const throttle = createTrailingThrottle(run, 5_000);
    // The panel opened and loaded its pods.
    run();
    throttle.markRan();
    for (let change = 0; change < 10; change += 1) {
      vi.advanceTimersByTime(100);
      throttle.call();
    }
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs a change right away once the interval has passed, and cancel drops a pending run", () => {
    const run = vi.fn();
    const throttle = createTrailingThrottle(run, 5_000);
    throttle.call();
    expect(run).toHaveBeenCalledTimes(1);
    throttle.call();
    throttle.cancel();
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    throttle.call();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("shouldReloadForTerminating", () => {
  it("reloads for terminating pods only within two minutes of the last object change", () => {
    const changedAt = 1_000_000;
    expect(shouldReloadForTerminating(true, changedAt, changedAt + 5_000)).toBe(true);
    expect(shouldReloadForTerminating(true, changedAt, changedAt + 119_000)).toBe(true);
    expect(shouldReloadForTerminating(true, changedAt, changedAt + 121_000)).toBe(false);
    expect(shouldReloadForTerminating(false, changedAt, changedAt + 5_000)).toBe(false);
  });
});
