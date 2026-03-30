import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseNamespaces,
  parsePodRestarts,
  parseNodes,
  parseMetricsServiceStatus,
  parseControlPlaneComponents,
} from "./parsers";
import { timeAgo } from "$shared/lib/timeFormatters";
import { prepareNodesBadge } from "$entities/cluster";

import type { NamespaceData, Pods, Nodes, NodeSpec } from "$shared/model/clusters";

vi.mock("@/lib/shared/lib/timeFormatters");
vi.mock("@/lib/entities/cluster/lib/metrics");

const mockedTimeAgo = vi.mocked(timeAgo);
const mockedPrepareNodesBadge = vi.mocked(prepareNodesBadge);

describe("parsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedTimeAgo.mockReturnValue("5 minutes ago");
  });

  describe("parseNamespaces", () => {
    it("should return array of namespace names", () => {
      const data: NamespaceData = {
        items: [{ metadata: { name: "default" } }, { metadata: { name: "kube-system" } }],
      };

      expect(parseNamespaces(data)).toEqual(["default", "kube-system"]);
    });

    it("should return empty array if data is undefined", () => {
      expect(parseNamespaces(undefined)).toEqual([]);
    });

    it("should return empty array if data.items is empty", () => {
      expect(parseNamespaces({ items: [] })).toEqual([]);
    });
  });

  describe("parsePodRestarts", () => {
    it("should extract container restart info with running state", () => {
      const data = {
        items: [
          {
            metadata: { name: "pod-1", namespace: "default" },
            status: {
              containerStatuses: [
                {
                  name: "app",
                  ready: true,
                  restartCount: 3,
                  state: { running: { startedAt: "2025-01-01T00:00:00Z" } },
                  lastState: {},
                },
              ],
            },
          },
        ],
      };

      const result = parsePodRestarts(data as Pods);

      expect(result).toEqual([
        {
          pod: "pod-1",
          namespace: "default",
          containers: [
            {
              containerName: "app",
              lastState: {},
              namespace: "default",
              startedAt: "5 minutes ago",
              state: { running: { startedAt: "2025-01-01T00:00:00Z" } },
              ready: true,
              restartCount: 3,
            },
          ],
        },
      ]);
    });

    it("should handle terminated/restarting containers (no startedAt)", () => {
      const data = {
        items: [
          {
            metadata: { name: "pod-2", namespace: "test" },
            status: {
              containerStatuses: [
                {
                  name: "sidecar",
                  ready: false,
                  restartCount: 10,
                  state: { terminated: { exitCode: 1 } },
                  lastState: {},
                },
              ],
            },
          },
        ],
      };

      mockedTimeAgo.mockReturnValue("");

      const result = parsePodRestarts(data as Pods);
      expect(
        result
          .find((p) => p.pod === "pod-2")
          ?.containers?.find((c) => c.containerName === "sidecar")?.startedAt,
      ).toBe("");
      expect(
        result
          .find((p) => p.pod === "pod-2")
          ?.containers?.find((c) => c.containerName === "sidecar")?.ready,
      ).toBe(false);
    });

    it("should return empty array if data is undefined", () => {
      expect(parsePodRestarts(undefined)).toEqual([]);
    });
  });

  describe("parseNodes", () => {
    it("should return checks and summary badge", () => {
      const mockBadge = {
        className: "success",
        status: "All good",
        count: { ready: 3, total: 3 },
      };

      mockedPrepareNodesBadge.mockReturnValue(mockBadge);

      const data = {
        items: [
          {
            metadata: { name: "node-1", creationTimestamp: "2025-01-01" },
            status: { conditions: [{ type: "Ready", status: "True" }] },
          },
        ],
      };

      const result = parseNodes(data as Nodes);

      expect(result).toEqual({
        checks: [
          {
            metadata: { name: "node-1", creationTimestamp: "2025-01-01" },
            status: { conditions: [{ type: "Ready", status: "True" }] },
            role: "",
          },
        ],
        summary: mockBadge,
      });

      expect(mockedPrepareNodesBadge).toHaveBeenCalledWith(data.items);
    });

    it("should return null if data is undefined", () => {
      expect(parseNodes(undefined)).toBeNull();
    });

    it("should return null if prepareNodesBadge throws", () => {
      mockedPrepareNodesBadge.mockImplementation(() => {
        throw new Error("Badge error");
      });

      const data = {
        items: [
          {
            metadata: {
              name: "bad",
              namespace: "default",
              creationTimestamp: "2025-01-01",
              uid: "123",
            },
            status: { conditions: [] },
            spec: {} as NodeSpec,
          },
        ],
      };

      expect(parseNodes(data as Nodes)).toBeNull();
    });
  });

  describe("parseMetricsServiceStatus", () => {
    const cases = [
      {
        name: "Not found (-1)",
        input: [{ result: -1 }],
        simple: "❌ Not found",
        detailed: "0 🔴",
      },
      {
        name: "Timeout (2)",
        input: [{ result: 1 }, { result: 2 }],
        simple: "⏳ Timeout",
        detailed: "-/2 🟠",
      },
      {
        name: "Some failed (0)",
        input: [{ result: 0 }, { result: 1 }],
        simple: "🟠 Installed but unreachable",
        detailed: "1/2 🟠",
      },
      {
        name: "All success",
        input: [{ result: 1 }, { result: 1 }],
        simple: "✅ Available",
        detailed: "2/2 🟢",
      },
      {
        name: "Empty array",
        input: [],
        simple: "❌ Not found",
        detailed: "0 🔴",
      },
    ];

    cases.forEach(({ name, input, simple, detailed }) => {
      it(`should handle ${name} in simple mode`, () => {
        expect(parseMetricsServiceStatus(input, "simple")).toBe(simple);
      });

      it(`should handle ${name} in detailed mode`, () => {
        expect(parseMetricsServiceStatus(input, "detailed")).toBe(detailed);
      });
    });

    it("should default to simple mode", () => {
      expect(parseMetricsServiceStatus([{ result: 1 }])).toBe("✅ Available");
    });
  });

  describe("parseControlPlaneComponents", () => {
    it("summarizes kube-system scheduler and controller-manager pods", () => {
      const data = {
        items: [
          {
            metadata: { name: "kube-scheduler-minikube", namespace: "kube-system" },
            status: {
              phase: "Running",
              containerStatuses: [{ name: "scheduler", ready: true, restartCount: 2, state: {} }],
            },
          },
          {
            metadata: { name: "kube-controller-manager-minikube", namespace: "kube-system" },
            status: {
              phase: "Running",
              containerStatuses: [{ name: "controller", ready: true, restartCount: 1, state: {} }],
            },
          },
        ],
      };

      expect(parseControlPlaneComponents(data as Pods)).toMatchObject({
        scheduler: {
          status: "ok",
          matchedPods: 1,
          readyPods: 1,
          totalRestarts: 2,
          podNames: ["kube-scheduler-minikube"],
        },
        controllerManager: {
          status: "ok",
          matchedPods: 1,
          readyPods: 1,
          totalRestarts: 1,
          podNames: ["kube-controller-manager-minikube"],
        },
      });
    });

    it("returns warning when control-plane pod is visible but not fully ready", () => {
      const data = {
        items: [
          {
            metadata: { name: "kube-scheduler-node-1", namespace: "kube-system" },
            status: {
              phase: "Running",
              containerStatuses: [{ name: "scheduler", ready: false, restartCount: 0, state: {} }],
            },
          },
        ],
      };

      expect(parseControlPlaneComponents(data as Pods)?.scheduler).toMatchObject({
        status: "warning",
        matchedPods: 1,
        readyPods: 0,
      });
    });
  });
});
