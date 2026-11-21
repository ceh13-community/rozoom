import { describe, expect, it } from "vitest";
import {
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
