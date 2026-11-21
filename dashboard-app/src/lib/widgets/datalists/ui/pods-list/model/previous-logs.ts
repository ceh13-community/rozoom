import type { ContainerStatus, PodItem } from "$shared/model/clusters";

export const ALL_CONTAINERS = "__all__";

export type PreviousLogsAvailability = {
  available: boolean;
  /** Why Previous is off-limits, for the disabled button; "" when it is available. */
  hint: string;
};

// kubectl logs --previous reads the instance before the last restart. A container that
// never restarted has none, and kubectl answers with an error instead of logs.
function hasPreviousInstance(status: ContainerStatus) {
  return status.restartCount > 0 || Boolean(status.lastState?.terminated);
}

/**
 * Whether Previous can show logs for the selected container. With all containers,
 * kubectl stops at the first container without a previous instance, so every
 * container needs one.
 */
export function previousLogsAvailability(
  pod: Partial<PodItem> | null | undefined,
  container: string,
): PreviousLogsAvailability {
  // Unknown pod (not in the list yet): leave the choice to the user.
  if (!pod?.status) return { available: true, hint: "" };
  const statuses = pod.status.containerStatuses ?? [];

  if (!container || container === ALL_CONTAINERS) {
    const restarted = statuses.filter(hasPreviousInstance).map((status) => status.name);
    if (restarted.length > 0 && restarted.length === statuses.length) {
      return { available: true, hint: "" };
    }
    if (restarted.length === 0) {
      return {
        available: false,
        hint: "No previous logs: no container in this pod has restarted.",
      };
    }
    return {
      available: false,
      hint: `Only ${restarted.join(", ")} restarted. Pick that container to see its previous logs.`,
    };
  }

  const status = statuses.find((entry) => entry.name === container);
  if (status && hasPreviousInstance(status)) return { available: true, hint: "" };
  return {
    available: false,
    hint: `No previous logs: container ${container} has not restarted.`,
  };
}
