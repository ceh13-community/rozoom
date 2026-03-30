import { describe, expect, it, vi } from "vitest";
import type { PodItem } from "$shared/model/clusters";

vi.mock("$shared/lib/timeFormatters", () => ({
  getTimeDifference: () => "5m",
}));

import { buildPodListRow, getPodReadySummary, getPodRef, getPodUid } from "./pod-row-adapter";

describe("pod row adapter", () => {
  it("builds a minimal row shape from pod data", () => {
    const row = buildPodListRow({
      metadata: {
        name: "api-0",
        namespace: "prod",
        uid: "uid-1",
      },
      spec: {
        nodeName: "node-a",
      },
      status: {
        startTime: "2026-03-08T10:00:00.000Z",
        phase: "Running",
        containerStatuses: [
          { ready: true, restartCount: 1, state: { running: {} } },
          { ready: false, restartCount: 2, state: { waiting: { reason: "CrashLoopBackOff" } } },
        ],
      },
    } as unknown as Partial<PodItem>);

    expect(row).toEqual({
      age: "5m",
      ageSeconds: expect.any(Number),
      name: "api-0",
      namespace: "prod",
      node: "node-a",
      readyContainers: 1,
      restarts: 3,
      status: "CrashLoopBackOff",
      totalContainers: 2,
      uid: "uid-1",
    });
  });

  it("returns stable pod identifiers and ready counts", () => {
    const pod = {
      metadata: {
        name: "worker-0",
        namespace: "jobs",
      },
      status: {
        containerStatuses: [{ ready: true, restartCount: 0, state: { running: {} } }],
      },
    } as unknown as Partial<PodItem>;

    expect(getPodUid(pod)).toBe("jobs/worker-0");
    expect(getPodRef(pod)).toBe("jobs/worker-0");
    expect(getPodReadySummary(pod)).toEqual({
      readyContainers: 1,
      totalContainers: 1,
    });
  });
});
