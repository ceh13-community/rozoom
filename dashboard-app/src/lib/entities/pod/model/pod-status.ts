import type { ContainerStatus, PodItem } from "$shared/model/clusters";
import { getPodStatus } from "../ui/formatters";

function getContainerState(status: ContainerStatus) {
  return (status.state as ContainerStatus["state"] | undefined) ?? undefined;
}

function getPodRuntimeStatus(pod: PodItem) {
  return (pod as Partial<PodItem>).status;
}

export function hasInitContainersNotCompleted(pod: PodItem): boolean {
  const initContainerStatuses = getPodRuntimeStatus(pod)?.initContainerStatuses;

  if (!initContainerStatuses || initContainerStatuses.length === 0) {
    return false;
  }

  return initContainerStatuses.some((status: ContainerStatus) => {
    const terminated = getContainerState(status)?.terminated;

    if (!terminated) {
      return true;
    }

    return terminated.exitCode !== 0;
  });
}

export function initHasWaitingReason(pod: PodItem, targetReason?: string): boolean {
  const initContainerStatuses = getPodRuntimeStatus(pod)?.initContainerStatuses;

  if (!initContainerStatuses || initContainerStatuses.length === 0) {
    return false;
  }

  return initContainerStatuses.some((status: ContainerStatus) => {
    const waitingState = getContainerState(status)?.waiting;

    if (!waitingState) {
      return false;
    }

    if (!targetReason) {
      return true;
    }

    return waitingState.reason === targetReason;
  });
}

export function anyContainerWaitingReason(pod: PodItem, targetReason?: string): boolean {
  const runtimeStatus = getPodRuntimeStatus(pod);
  const initStatuses = runtimeStatus?.initContainerStatuses ?? [];
  const containerStatuses = runtimeStatus?.containerStatuses ?? [];

  const allStatuses = [...initStatuses, ...containerStatuses];

  if (allStatuses.length === 0) {
    return false;
  }

  return allStatuses.some((status: ContainerStatus) => {
    const waitingState = getContainerState(status)?.waiting;

    if (!waitingState) {
      return false;
    }

    if (!targetReason) {
      return true;
    }

    return waitingState.reason === targetReason;
  });
}

export function anyContainerTerminatedReason(pod: PodItem, targetReason?: string): boolean {
  const runtimeStatus = getPodRuntimeStatus(pod);
  const initStatuses = runtimeStatus?.initContainerStatuses ?? [];
  const containerStatuses = runtimeStatus?.containerStatuses ?? [];

  const allStatuses = [...initStatuses, ...containerStatuses];

  if (allStatuses.length === 0) {
    return false;
  }

  return allStatuses.some((status: ContainerStatus) => {
    const terminatedState = getContainerState(status)?.terminated;

    if (!terminatedState) {
      return false;
    }

    if (!targetReason) {
      return true;
    }

    return terminatedState.reason === targetReason;
  });
}

export function getAllContainerWaitingReasons(pod: PodItem): {
  containerName: string;
  containerType: "init" | "regular";
  reason: string;
  message?: string;
}[] {
  const runtimeStatus = getPodRuntimeStatus(pod);
  const initStatuses = runtimeStatus?.initContainerStatuses ?? [];
  const containerStatuses = runtimeStatus?.containerStatuses ?? [];

  const initReasons = initStatuses.flatMap((status: ContainerStatus) => {
    const waitingState = getContainerState(status)?.waiting;
    if (!waitingState) return [];
    return [
      {
        containerName: status.name,
        containerType: "init" as const,
        reason: waitingState.reason || "Unknown",
        message: waitingState.message,
      },
    ];
  });

  const regularReasons = containerStatuses.flatMap((status: ContainerStatus) => {
    const waitingState = getContainerState(status)?.waiting;
    if (!waitingState) return [];
    return [
      {
        containerName: status.name,
        containerType: "regular" as const,
        reason: waitingState.reason || "Unknown",
        message: waitingState.message,
      },
    ];
  });

  return [...initReasons, ...regularReasons];
}

export function getInitWaitingReasons(pod: PodItem): {
  containerName: string;
  reason: string;
  message?: string;
}[] {
  const initContainerStatuses = getPodRuntimeStatus(pod)?.initContainerStatuses;

  if (!initContainerStatuses || initContainerStatuses.length === 0) {
    return [];
  }

  return initContainerStatuses.flatMap((status: ContainerStatus) => {
    const waitingState = getContainerState(status)?.waiting;
    if (!waitingState) return [];
    return [
      {
        containerName: status.name,
        reason: waitingState.reason || "Unknown",
        message: waitingState.message,
      },
    ];
  });
}

export function getAllContainerTerminatedReasons(pod: PodItem): Array<{
  containerName: string;
  containerType: "init" | "regular";
  reason: string;
  exitCode?: number;
  message?: string;
}> {
  const runtimeStatus = getPodRuntimeStatus(pod);
  const initStatuses = runtimeStatus?.initContainerStatuses ?? [];
  const containerStatuses = runtimeStatus?.containerStatuses ?? [];

  const initReasons = initStatuses.flatMap((status: ContainerStatus) => {
    const terminatedState = getContainerState(status)?.terminated;
    if (!terminatedState) return [];
    return [
      {
        containerName: status.name,
        containerType: "init" as const,
        reason: terminatedState.reason || "Unknown",
        exitCode: terminatedState.exitCode,
        message: terminatedState.message,
      },
    ];
  });

  const regularReasons = containerStatuses.flatMap((status: ContainerStatus) => {
    const terminatedState = getContainerState(status)?.terminated;
    if (!terminatedState) return [];
    return [
      {
        containerName: status.name,
        containerType: "regular" as const,
        reason: terminatedState.reason || "Unknown",
        exitCode: terminatedState.exitCode,
        message: terminatedState.message,
      },
    ];
  });

  return [...initReasons, ...regularReasons];
}

export const getStringPodStatus = (pod: PodItem) => {
  if (pod.metadata.deletionTimestamp) return "⚰️ Terminating";

  if (hasInitContainersNotCompleted(pod)) {
    const initContainerStatuses = getPodRuntimeStatus(pod)?.initContainerStatuses ?? [];
    const total = initContainerStatuses.length;
    const ready = initContainerStatuses.filter((status) => status.ready).length;

    if (initHasWaitingReason(pod)) {
      const reason = getInitWaitingReasons(pod)[0]?.reason;
      return reason ? `🌱 Init: ${reason}` : `🌱 Init: ${ready}/${total}`;
    }

    return `🌱 Init: ${ready}/${total}`;
  }

  if (anyContainerWaitingReason(pod)) {
    return getAllContainerWaitingReasons(pod)[0]?.reason || getPodStatus(pod);
  }

  if (anyContainerTerminatedReason(pod)) {
    return getAllContainerTerminatedReasons(pod)[0]?.reason || getPodStatus(pod);
  }

  return getPodStatus(pod);
};
