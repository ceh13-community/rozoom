import { describe, it, expect } from "vitest";
import {
  anyContainerTerminatedReason,
  anyContainerWaitingReason,
  getAllContainerTerminatedReasons,
  getAllContainerWaitingReasons,
  getInitWaitingReasons,
  hasInitContainersNotCompleted,
  initHasWaitingReason,
} from "./pod-status";
import type { PodItem, ContainerStatus } from "$shared/model/clusters";

describe("hasInitContainersNotCompleted", () => {
  it("should return false when pod.status is missing", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
    } as PodItem;

    expect(hasInitContainersNotCompleted(pod)).toBe(false);
  });

  it("should return false if no initContainerStatuses", () => {
    const pod: PodItem = {
      status: {},
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(false);
  });

  it("should return false if initContainerStatuses is empty", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(false);
  });

  it("should return true if init container has no terminated state", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(true);
  });

  it("should return true if init container is terminated with non-zero exitCode", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "Error",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(true);
  });

  it("should return false if all init containers are terminated with exitCode 0", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(false);
  });

  it("should return true if at least one init container is not completed with success", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "Error",
              },
            },
          } as ContainerStatus,
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(true);
  });

  it("should return true if init container is in running state", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              running: {
                startedAt: "2024-01-01T00:00:00Z",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(true);
  });

  it("should return true if there are both successful init containers and crashing init containers", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
          {
            state: {
              waiting: { reason: "CrashLoopBackOff" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = hasInitContainersNotCompleted(pod);

    expect(result).toBe(true);
  });
});

describe("initHasWaitingReason", () => {
  it("should return false when pod.status is missing", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
    } as PodItem;

    expect(initHasWaitingReason(pod)).toBe(false);
  });

  it("should return false if initContainerStatuses is undefined", () => {
    const pod: PodItem = {
      status: {},
    } as PodItem;

    const result = initHasWaitingReason(pod);

    expect(result).toBe(false);
  });

  it("should return false if initContainerStatuses is empty array", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod);

    expect(result).toBe(false);
  });

  it("should return false if no container has waiting state", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
          {
            state: {
              running: {
                startedAt: "2024-01-01T00:00:00Z",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod);

    expect(result).toBe(false);
  });

  it("should return true if any container has waiting state and no targetReason provided", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod);

    expect(result).toBe(true);
  });

  it("should return true if container waiting reason matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: {
                reason: "CrashLoopBackOff",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(true);
  });

  it("should return false if container waiting reason does not match targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(false);
  });

  it("should return true if at least one container matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
          {
            state: {
              waiting: {
                reason: "CrashLoopBackOff",
              },
            },
          } as ContainerStatus,
          {
            state: {
              terminated: {
                exitCode: 0,
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(true);
  });

  it("should return true if any container has waiting state when targetReason is undefined", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
              },
            },
          } as ContainerStatus,
          {
            state: {
              waiting: {
                reason: "ImagePullBackOff",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod, undefined);

    expect(result).toBe(true);
  });

  it("should return false if all containers are not in waiting state with specific targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: {
                reason: "ImagePullBackOff",
              },
            },
          } as ContainerStatus,
          {
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = initHasWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(false);
  });
});

describe("anyContainerWaitingReason", () => {
  it("should return false if both initContainerStatuses and containerStatuses are undefined", () => {
    const pod: PodItem = {
      status: {},
    } as PodItem;

    const result = anyContainerWaitingReason(pod);

    expect(result).toBe(false);
  });

  it("should return false if both initContainerStatuses and containerStatuses are empty", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        containerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod);

    expect(result).toBe(false);
  });

  it("should return false if no containers have waiting state", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: { exitCode: 0 },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              running: { startedAt: "2024-01-01T00:00:00Z" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod);

    expect(result).toBe(false);
  });

  it("should return true if init container has waiting state and no targetReason provided", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod);

    expect(result).toBe(true);
  });

  it("should return true if regular container has waiting state and no targetReason provided", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            state: {
              waiting: { reason: "ImagePullBackOff" },
            },
          } as ContainerStatus,
        ],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod);

    expect(result).toBe(true);
  });

  it("should return true if init container waiting reason matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "CrashLoopBackOff" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(true);
  });

  it("should return true if regular container waiting reason matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            state: {
              waiting: { reason: "ErrImagePull" },
            },
          } as ContainerStatus,
        ],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod, "ErrImagePull");

    expect(result).toBe(true);
  });

  it("should return false if waiting reason does not match targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              waiting: { reason: "ImagePullBackOff" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(false);
  });

  it("should return true if any container from both types matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              waiting: { reason: "CrashLoopBackOff" },
            },
          } as ContainerStatus,
          {
            state: {
              running: { startedAt: "2024-01-01T00:00:00Z" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod, "CrashLoopBackOff");

    expect(result).toBe(true);
  });

  it("should return true if any container has waiting state without targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: { exitCode: 0 },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              running: { startedAt: "2024-01-01T00:00:00Z" },
            },
          } as ContainerStatus,
          {
            state: {
              waiting: { reason: "CreateContainerConfigError" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod);

    expect(result).toBe(true);
  });

  it("should handle undefined initContainerStatuses with defined containerStatuses", () => {
    const pod: PodItem = {
      status: {
        containerStatuses: [
          {
            state: {
              waiting: { reason: "ImagePullBackOff" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod, "ImagePullBackOff");

    expect(result).toBe(true);
  });

  it("should handle undefined containerStatuses with defined initContainerStatuses", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerWaitingReason(pod, "PodInitializing");

    expect(result).toBe(true);
  });
});

describe("anyContainerTerminatedReason", () => {
  it("should return false if both initContainerStatuses and containerStatuses are undefined", () => {
    const pod: PodItem = {
      status: {},
    } as PodItem;

    const result = anyContainerTerminatedReason(pod);

    expect(result).toBe(false);
  });

  it("should return false if both initContainerStatuses and containerStatuses are empty", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        containerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod);

    expect(result).toBe(false);
  });

  it("should return false if no containers have terminated state", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              running: { startedAt: "2024-01-01T00:00:00Z" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod);

    expect(result).toBe(false);
  });

  it("should return true if init container has terminated state and no targetReason provided", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod);

    expect(result).toBe(true);
  });

  it("should return true if regular container has terminated state and no targetReason provided", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "Error",
              },
            },
          } as ContainerStatus,
        ],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod);

    expect(result).toBe(true);
  });

  it("should return true if init container terminated reason matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "OOMKilled",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "OOMKilled");

    expect(result).toBe(true);
  });

  it("should return true if regular container terminated reason matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 137,
                reason: "Error",
              },
            },
          } as ContainerStatus,
        ],
        phase: "",
      },
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "Error");

    expect(result).toBe(true);
  });

  it("should return false if terminated reason does not match targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "Error",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "OOMKilled");

    expect(result).toBe(false);
  });

  it("should return true if any container from both types matches targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 137,
                reason: "OOMKilled",
              },
            },
          } as ContainerStatus,
          {
            state: {
              running: { startedAt: "2024-01-01T00:00:00Z" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "OOMKilled");

    expect(result).toBe(true);
  });

  it("should return true if any container has terminated state without targetReason", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              waiting: { reason: "PodInitializing" },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              running: { startedAt: "2024-01-01T00:00:00Z" },
            },
          } as ContainerStatus,
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "ContainerCannotRun",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod);

    expect(result).toBe(true);
  });

  it("should handle undefined initContainerStatuses with defined containerStatuses", () => {
    const pod: PodItem = {
      status: {
        containerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 143,
                reason: "Error",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "Error");

    expect(result).toBe(true);
  });

  it("should handle undefined containerStatuses with defined initContainerStatuses", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "Completed");

    expect(result).toBe(true);
  });

  it("should return true for multiple terminated containers with different reasons when one matches", () => {
    const pod: PodItem = {
      status: {
        initContainerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 0,
                reason: "Completed",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            state: {
              terminated: {
                exitCode: 1,
                reason: "Error",
              },
            },
          } as ContainerStatus,
          {
            state: {
              terminated: {
                exitCode: 137,
                reason: "OOMKilled",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = anyContainerTerminatedReason(pod, "OOMKilled");

    expect(result).toBe(true);
  });
});

describe("getAllContainerWaitingReasons", () => {
  it("should return an empty array if there are no containers in waiting state", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-container",
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            name: "app-container",
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toEqual([]);
  });

  it("should return reasons for init containers in waiting state", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [
          {
            name: "init-1",
            namespace: "default",
            ready: false,
            restartCount: 0,
            state: {
              waiting: {
                reason: "PodInitializing",
                message: "Waiting for init",
              },
            },
          } as ContainerStatus,
          {
            name: "init-2",
            namespace: "default",
            ready: false,
            restartCount: 0,
            state: {
              waiting: {
                reason: "ImagePullBackOff",
                message: "Error",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
        phase: "",
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      containerName: "init-1",
      containerType: "init",
      reason: "PodInitializing",
      message: "Waiting for init",
    });
    expect(result[1]).toEqual({
      containerName: "init-2",
      containerType: "init",
      reason: "ImagePullBackOff",
      message: "Error",
    });
  });

  it("should return reasons for regular containers in waiting state", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            name: "app-container",
            namespace: "default",
            ready: false,
            restartCount: 0,
            state: {
              waiting: {
                reason: "CrashLoopBackOff",
                message: "Back-off restarting failed container",
              },
            },
          } as ContainerStatus,
        ],
        phase: "",
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      containerName: "app-container",
      containerType: "regular",
      reason: "CrashLoopBackOff",
      message: "Back-off restarting failed container",
    });
  });

  it("should return reasons for both container types", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-1",
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            name: "app-1",
            state: {
              waiting: {
                reason: "ImagePullBackOff",
              },
            },
          } as ContainerStatus,
          {
            name: "app-2",
            state: {
              waiting: {
                reason: "ErrImagePull",
                message: "Failed to pull image",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(3);

    expect(result[0].containerType).toBe("init");
    expect(result[0].containerName).toBe("init-1");

    expect(result[1].containerType).toBe("regular");
    expect(result[1].containerName).toBe("app-1");

    expect(result[2].containerType).toBe("regular");
    expect(result[2].containerName).toBe("app-2");
    expect(result[2].message).toBe("Failed to pull image");
  });

  it('should use "Unknown" if no reason', () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            name: "app-container",
            ready: false,
            restartCount: 0,
            state: {
              waiting: {},
            },
          } as any,
        ],
        phase: "",
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("Unknown");
  });

  it("should pass if no initContainerStatuses", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "app-container",
            state: {
              waiting: {
                reason: "ContainerCreating",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerType).toBe("regular");
  });

  it("should pass if no containerStatuses", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-container",
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerType).toBe("init");
  });

  it("should pass both if no initContainerStatuses and no containerStatuses", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {},
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toEqual([]);
  });

  it("should filter containers that are non-waiting", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "running-container",
            state: {
              running: { startedAt: "2024-01-01" },
            },
          } as ContainerStatus,
          {
            name: "waiting-container",
            state: {
              waiting: {
                reason: "ImagePullBackOff",
              },
            },
          } as ContainerStatus,
          {
            name: "terminated-container",
            state: {
              terminated: { exitCode: 0 },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerName).toBe("waiting-container");
  });

  it("should set message as undefined if no message", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "app-container",
            state: {
              waiting: {
                reason: "ErrImagePull",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerWaitingReasons(pod);

    expect(result[0].message).toBeUndefined();
  });

  it("should correctly handle multiple reasons", () => {
    const reasons = [
      "ImagePullBackOff",
      "ErrImagePull",
      "CrashLoopBackOff",
      "CreateContainerConfigError",
      "InvalidImageName",
      "ContainerCreating",
    ];

    reasons.forEach((reason, index) => {
      const pod: PodItem = {
        metadata: { name: "test-pod" },
        spec: {},
        status: {
          containerStatuses: [
            {
              name: `container-${index}`,
              state: {
                waiting: { reason },
              },
            } as ContainerStatus,
          ],
        },
      } as PodItem;

      const result = getAllContainerWaitingReasons(pod);

      expect(result[0].reason).toBe(reason);
    });
  });
});

describe("getInitWaitingReasons", () => {
  it("should return empty array when pod.status is missing", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
    } as PodItem;

    expect(getInitWaitingReasons(pod)).toEqual([]);
  });

  it("should return empty array when initContainerStatuses is undefined", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {},
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toEqual([]);
  });

  it("should return empty array when initContainerStatuses is empty", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "test-namespace" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [],
        phase: "",
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toEqual([]);
  });

  it("should return empty array when no init containers are waiting", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-1",
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
          {
            name: "init-2",
            state: { terminated: { exitCode: 0 } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toEqual([]);
  });

  it("should return waiting reason for single init container", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-setup",
            state: {
              waiting: {
                reason: "PodInitializing",
                message: "Initializing pod",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      containerName: "init-setup",
      reason: "PodInitializing",
      message: "Initializing pod",
    });
  });

  it("should return waiting reasons for multiple init containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-1",
            state: {
              waiting: {
                reason: "ImagePullBackOff",
                message: "Failed to pull image",
              },
            },
          } as ContainerStatus,
          {
            name: "init-2",
            state: {
              waiting: {
                reason: "PodInitializing",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      containerName: "init-1",
      reason: "ImagePullBackOff",
      message: "Failed to pull image",
    });
    expect(result[1]).toEqual({
      containerName: "init-2",
      reason: "PodInitializing",
      message: undefined,
    });
  });

  it("should filter out non-waiting init containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-running",
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
          {
            name: "init-waiting",
            state: {
              waiting: {
                reason: "ImagePullBackOff",
              },
            },
          } as ContainerStatus,
          {
            name: "init-terminated",
            state: { terminated: { exitCode: 0 } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerName).toBe("init-waiting");
  });

  it('should use "Unknown" as reason when reason is missing', () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-container",
            state: {
              waiting: {},
            },
          } as any,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("Unknown");
  });

  it("should handle missing message field", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-container",
            state: {
              waiting: {
                reason: "ErrImagePull",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result[0].message).toBeUndefined();
  });

  it("should handle various waiting reasons", () => {
    const reasons = [
      "ImagePullBackOff",
      "ErrImagePull",
      "CreateContainerConfigError",
      "InvalidImageName",
      "PodInitializing",
    ];

    reasons.forEach((reason) => {
      const pod: PodItem = {
        metadata: { name: "test-pod" },
        spec: {},
        status: {
          initContainerStatuses: [
            {
              name: "init-test",
              state: {
                waiting: { reason },
              },
            } as ContainerStatus,
          ],
        },
      } as PodItem;

      const result = getInitWaitingReasons(pod);

      expect(result[0].reason).toBe(reason);
    });
  });

  it("should preserve container order from status array", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-first",
            state: { waiting: { reason: "Reason1" } },
          } as ContainerStatus,
          {
            name: "init-second",
            state: { waiting: { reason: "Reason2" } },
          } as ContainerStatus,
          {
            name: "init-third",
            state: { waiting: { reason: "Reason3" } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getInitWaitingReasons(pod);

    expect(result).toHaveLength(3);
    expect(result[0].containerName).toBe("init-first");
    expect(result[1].containerName).toBe("init-second");
    expect(result[2].containerName).toBe("init-third");
  });
});

describe("getAllContainerTerminatedReasons", () => {
  it("should return empty array when no containers are terminated", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-container",
            state: { running: { startedAt: "2024-01-01" } },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            name: "app-container",
            state: { waiting: { reason: "ContainerCreating" } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toEqual([]);
  });

  it("should return terminated reasons for init containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "test-namespace" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [
          {
            name: "init-1",
            state: {
              terminated: {
                reason: "Completed",
                exitCode: 0,
                message: "Successfully completed",
              },
            },
          } as ContainerStatus,
          {
            name: "init-2",
            state: {
              terminated: {
                reason: "Error",
                exitCode: 1,
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [],
        phase: "",
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      containerName: "init-1",
      containerType: "init",
      reason: "Completed",
      exitCode: 0,
      message: "Successfully completed",
    });
    expect(result[1]).toEqual({
      containerName: "init-2",
      containerType: "init",
      reason: "Error",
      exitCode: 1,
      message: undefined,
    });
  });

  it("should return terminated reasons for regular containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "test-namespace" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            name: "app-container",
            state: {
              terminated: {
                reason: "OOMKilled",
                exitCode: 137,
                message: "Out of memory",
              },
            },
          } as ContainerStatus,
        ],
        phase: "",
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      containerName: "app-container",
      containerType: "regular",
      reason: "OOMKilled",
      exitCode: 137,
      message: "Out of memory",
    });
  });

  it("should return terminated reasons for both init and regular containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-setup",
            state: {
              terminated: {
                reason: "Completed",
                exitCode: 0,
              },
            },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            name: "app-1",
            state: {
              terminated: {
                reason: "Error",
                exitCode: 1,
              },
            },
          } as ContainerStatus,
          {
            name: "app-2",
            state: {
              terminated: {
                reason: "CrashLoopBackOff",
                exitCode: 143,
                message: "Container crashed",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(3);

    expect(result[0].containerType).toBe("init");
    expect(result[0].containerName).toBe("init-setup");

    expect(result[1].containerType).toBe("regular");
    expect(result[1].containerName).toBe("app-1");

    expect(result[2].containerType).toBe("regular");
    expect(result[2].containerName).toBe("app-2");
    expect(result[2].message).toBe("Container crashed");
  });

  it('should use "Unknown" as reason when reason is missing', () => {
    const pod: PodItem = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [],
        nodeName: "test-node",
        volumes: [],
      },
      status: {
        initContainerStatuses: [],
        containerStatuses: [
          {
            name: "app-container",
            state: {
              terminated: {
                exitCode: 1,
              },
            },
          } as any,
        ],
        phase: "",
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("Unknown");
  });

  it("should handle missing exitCode field", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "app-container",
            state: {
              terminated: {
                reason: "Error",
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result[0].exitCode).toBeUndefined();
  });

  it("should handle missing message field", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "app-container",
            state: {
              terminated: {
                reason: "Completed",
                exitCode: 0,
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result[0].message).toBeUndefined();
  });

  it("should handle missing initContainerStatuses", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "app-container",
            state: {
              terminated: {
                reason: "Error",
                exitCode: 1,
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerType).toBe("regular");
  });

  it("should handle missing containerStatuses", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-container",
            state: {
              terminated: {
                reason: "Completed",
                exitCode: 0,
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerType).toBe("init");
  });

  it("should handle missing both status arrays", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {},
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toEqual([]);
  });

  it("should filter out non-terminated containers", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "running-container",
            state: {
              running: { startedAt: "2024-01-01" },
            },
          } as ContainerStatus,
          {
            name: "terminated-container",
            state: {
              terminated: {
                reason: "Error",
                exitCode: 1,
              },
            },
          } as ContainerStatus,
          {
            name: "waiting-container",
            state: {
              waiting: { reason: "ContainerCreating" },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(1);
    expect(result[0].containerName).toBe("terminated-container");
  });

  it("should handle various termination reasons", () => {
    const reasons = [
      { reason: "Completed", exitCode: 0 },
      { reason: "Error", exitCode: 1 },
      { reason: "OOMKilled", exitCode: 137 },
      { reason: "ContainerCannotRun", exitCode: 128 },
      { reason: "DeadlineExceeded", exitCode: 143 },
    ];

    reasons.forEach(({ reason, exitCode }) => {
      const pod: PodItem = {
        metadata: { name: "test-pod" },
        spec: {},
        status: {
          containerStatuses: [
            {
              name: "test-container",
              state: {
                terminated: { reason, exitCode },
              },
            } as ContainerStatus,
          ],
        },
      } as PodItem;

      const result = getAllContainerTerminatedReasons(pod);

      expect(result[0].reason).toBe(reason);
      expect(result[0].exitCode).toBe(exitCode);
    });
  });

  it("should handle exitCode 0 for successful completion", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        containerStatuses: [
          {
            name: "app-container",
            state: {
              terminated: {
                reason: "Completed",
                exitCode: 0,
              },
            },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result[0].exitCode).toBe(0);
    expect(result[0].reason).toBe("Completed");
  });

  it("should preserve container order from status arrays", () => {
    const pod: PodItem = {
      metadata: { name: "test-pod" },
      spec: {},
      status: {
        initContainerStatuses: [
          {
            name: "init-1",
            state: { terminated: { reason: "Completed", exitCode: 0 } },
          } as ContainerStatus,
          {
            name: "init-2",
            state: { terminated: { reason: "Completed", exitCode: 0 } },
          } as ContainerStatus,
        ],
        containerStatuses: [
          {
            name: "app-1",
            state: { terminated: { reason: "Error", exitCode: 1 } },
          } as ContainerStatus,
          {
            name: "app-2",
            state: { terminated: { reason: "OOMKilled", exitCode: 137 } },
          } as ContainerStatus,
        ],
      },
    } as PodItem;

    const result = getAllContainerTerminatedReasons(pod);

    expect(result).toHaveLength(4);
    expect(result[0].containerName).toBe("init-1");
    expect(result[1].containerName).toBe("init-2");
    expect(result[2].containerName).toBe("app-1");
    expect(result[3].containerName).toBe("app-2");
  });
});
