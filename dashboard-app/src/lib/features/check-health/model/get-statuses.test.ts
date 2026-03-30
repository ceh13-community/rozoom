import { describe, it, expect } from "vitest";
import type { PodRestart } from "./types";
import { countTotalPodRestarts } from "./get-statuses";

describe("getStatuses", () => {
  describe("countTotalPodRestarts", () => {
    it("should count restartCount of all containers in all pods", () => {
      const podRestarts: PodRestart[] = [
        {
          pod: "pod-1",
          namespace: "default",
          containers: [
            { containerName: "app", restartCount: 3, namespace: "default", ready: true, state: {} },
            {
              containerName: "sidecar",
              restartCount: 1,
              namespace: "default",
              ready: true,
              state: {},
            },
          ],
        },
        {
          pod: "pod-2",
          namespace: "kube-system",
          containers: [
            {
              containerName: "main",
              restartCount: 5,
              namespace: "default",
              ready: true,
              state: {},
            },
          ],
        },
      ];

      expect(countTotalPodRestarts(podRestarts)).toBe(3 + 1 + 5);
    });

    it("should return 0, if podRestarts is empty", () => {
      expect(countTotalPodRestarts([])).toBe(0);
      expect(countTotalPodRestarts(null)).toBe(0);
    });

    it("should return 0, if containers are empty", () => {
      const podRestarts: PodRestart[] = [{ pod: "pod-1", namespace: "default", containers: [] }];

      expect(countTotalPodRestarts(podRestarts)).toBe(0);
    });
  });
});
