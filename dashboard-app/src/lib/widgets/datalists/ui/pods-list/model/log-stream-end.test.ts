import { describe, expect, it } from "vitest";
import type { PodItem } from "$shared/model/clusters";
import { logStreamEndReason, logStreamReconnectDelay } from "./log-stream-end";

const pod = (phase: string, restartPolicy?: string, terminated = false) =>
  ({
    spec: { containers: [{ name: "job" }], restartPolicy },
    status: {
      phase,
      containerStatuses: [
        {
          name: "job",
          ready: false,
          restartCount: 0,
          state: terminated
            ? { terminated: { exitCode: 0, message: "", reason: "Completed" } }
            : { running: { startedAt: "2026-11-21T10:00:00Z" } },
        },
      ],
    },
  }) as unknown as Partial<PodItem>;

describe("logStreamEndReason", () => {
  it("ends the stream of a finished pod (a Job's pod)", () => {
    expect(logStreamEndReason(pod("Succeeded"), "job")).toBe(
      "Stream ended: the pod has completed.",
    );
    expect(logStreamEndReason(pod("Failed"), "job")).toBe("Stream ended: the pod has failed.");
  });

  it("ends it when the container exited and the pod never restarts it", () => {
    expect(logStreamEndReason(pod("Running", "Never", true), "job")).toBe(
      "Stream ended: the container has exited.",
    );
  });

  it("keeps reconnecting for a running pod or one that restarts its containers", () => {
    expect(logStreamEndReason(pod("Running"), "job")).toBeNull();
    expect(logStreamEndReason(pod("Running", "Always", true), "job")).toBeNull();
    expect(logStreamEndReason(null, "job")).toBeNull();
  });
});

describe("logStreamReconnectDelay", () => {
  it("doubles from 1.2 s up to 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(logStreamReconnectDelay)).toEqual([
      1_200, 2_400, 4_800, 9_600, 19_200, 30_000, 30_000,
    ]);
  });
});
