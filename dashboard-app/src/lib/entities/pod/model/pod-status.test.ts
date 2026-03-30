import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PodItem, ContainerStatus } from "$shared/model/clusters";
import { getStringPodStatus } from "./pod-status";

describe("getStringPodStatus", () => {
  it("should not crash when pod.status is missing", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {},
    } as PodItem;

    expect(() => getStringPodStatus(pod)).not.toThrow();
    expect(getStringPodStatus(pod)).toBeTruthy();
  });

  it('should return "⚰️ Terminating" when pod has deletionTimestamp', () => {
    const pod: PodItem = {
      metadata: {
        name: "test-pod",
        deletionTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: {},
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "app",
            ready: true,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("⚰️ Terminating");
  });

  it("should return init status with waiting reason", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        phase: "Pending",
        initContainerStatuses: [
          {
            name: "init-1",
            ready: false,
            state: {
              waiting: {
                reason: "ImagePullBackOff",
                message: "Failed to pull image",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("🌱 Init: ImagePullBackOff");
  });

  it("should return init progress when init containers are running without waiting reason", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        phase: "Pending",
        initContainerStatuses: [
          {
            name: "init-1",
            ready: true,
            state: { terminated: { exitCode: 0, reason: "Completed" } },
          } as ContainerStatus,
          {
            name: "init-2",
            ready: false,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
          {
            name: "init-3",
            ready: false,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
        containerStatuses: [],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("🌱 Init: 1/3");
  });

  it("should return container waiting reason when main containers are waiting", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Pending",
        containerStatuses: [
          {
            name: "app",
            ready: false,
            state: {
              waiting: {
                reason: "CrashLoopBackOff",
                message: "Container crashed",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("CrashLoopBackOff");
  });

  it("should ignore malformed container statuses without state objects", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Pending",
        containerStatuses: [
          {
            name: "broken",
            ready: false,
            state: undefined,
          } as unknown as ContainerStatus,
          {
            name: "app",
            ready: false,
            state: {
              waiting: {
                reason: "ContainerCreating",
                message: "Pulling image",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    expect(getStringPodStatus(pod)).toBe("ContainerCreating");
  });

  it("should return container terminated reason when containers are terminated", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Failed",
        containerStatuses: [
          {
            name: "app",
            ready: false,
            state: {
              terminated: {
                reason: "OOMKilled",
                exitCode: 137,
                message: "Out of memory",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("OOMKilled");
  });

  it("should return default pod status when all containers are running", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "app",
            ready: true,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    // This will return whatever getPodStatus returns - likely 'Running' or similar
    expect(result).toBeTruthy();
    expect(result).not.toContain("Init");
    expect(result).not.toContain("Terminating");
  });

  it("should prioritize terminating over init containers", () => {
    const pod: PodItem = {
      metadata: {
        name: "test-pod",
        deletionTimestamp: "2024-01-01T00:00:00Z",
      },
      spec: {},
      status: {
        phase: "Running",
        initContainerStatuses: [
          {
            name: "init-1",
            ready: false,
            state: {
              waiting: { reason: "ImagePullBackOff" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("⚰️ Terminating");
  });

  it("should prioritize init containers over main container waiting", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Pending",
        initContainerStatuses: [
          {
            name: "init-1",
            ready: false,
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            name: "app",
            ready: false,
            state: {
              waiting: { reason: "ContainerCreating" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("🌱 Init: PodInitializing");
  });

  it("should prioritize waiting over terminated for main containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Running",
        containerStatuses: [
          {
            name: "app-1",
            ready: false,
            state: {
              waiting: { reason: "CrashLoopBackOff" },
            },
          } as ContainerStatus,
          {
            name: "app-2",
            ready: false,
            state: {
              terminated: { reason: "Error", exitCode: 1 },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("CrashLoopBackOff");
  });

  it("should handle init containers with 0 ready", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        phase: "Pending",
        initContainerStatuses: [
          {
            name: "init-1",
            ready: false,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
          {
            name: "init-2",
            ready: false,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
        containerStatuses: [],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("🌱 Init: 0/2");
  });

  it("should handle multiple init containers with mixed states", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        phase: "Pending",
        initContainerStatuses: [
          {
            name: "init-1",
            ready: true,
            state: { terminated: { exitCode: 0, reason: "Completed" } },
          } as ContainerStatus,
          {
            name: "init-2",
            ready: true,
            state: { terminated: { exitCode: 0, reason: "Completed" } },
          } as ContainerStatus,
          {
            name: "init-3",
            ready: false,
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
        containerStatuses: [],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("🌱 Init: 2/3");
  });

  it("should use first waiting reason from multiple waiting containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Pending",
        containerStatuses: [
          {
            name: "app-1",
            ready: false,
            state: {
              waiting: { reason: "ImagePullBackOff" },
            },
          } as ContainerStatus,
          {
            name: "app-2",
            ready: false,
            state: {
              waiting: { reason: "ErrImagePull" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("ImagePullBackOff");
  });

  it("should use first terminated reason from multiple terminated containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        phase: "Failed",
        containerStatuses: [
          {
            name: "app-1",
            ready: false,
            state: {
              terminated: { reason: "Error", exitCode: 1 },
            },
          } as ContainerStatus,
          {
            name: "app-2",
            ready: false,
            state: {
              terminated: { reason: "OOMKilled", exitCode: 137 },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getStringPodStatus(pod);

    expect(result).toBe("Error");
  });
});
