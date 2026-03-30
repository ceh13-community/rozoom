import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPodEvents } from "./load-pod-events";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront }));

describe("loadPodEvents", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
  });

  it("returns mapped events", async () => {
    kubectlRawArgsFront.mockResolvedValueOnce({
      code: 0,
      output: JSON.stringify({
        items: [
          {
            type: "Warning",
            reason: "BackOff",
            message: "Back-off restarting failed container",
            count: 3,
            lastTimestamp: "2026-02-12T12:00:00Z",
            source: { component: "kubelet" },
          },
        ],
      }),
    });

    const result = await loadPodEvents("cluster-1", {
      metadata: { name: "pod-a", namespace: "default", uid: "uid-1" },
    });

    expect(result).toEqual([
      {
        type: "Warning",
        reason: "BackOff",
        message: "Back-off restarting failed container",
        count: 3,
        lastTimestamp: "2026-02-12T12:00:00Z",
        source: "kubelet",
      },
    ]);
  });

  it("throws on kubectl error", async () => {
    kubectlRawArgsFront.mockResolvedValueOnce({ code: 1, errors: "boom" });
    await expect(
      loadPodEvents("cluster-1", { metadata: { name: "pod-a", namespace: "default" } }),
    ).rejects.toThrow("boom");
  });
});
