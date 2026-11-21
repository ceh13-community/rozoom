import type { PodItem } from "$shared/model/clusters";
import { ALL_CONTAINERS } from "./previous-logs";

/** First retry after a stream drops; doubles per failed try up to the cap. */
export const LOG_STREAM_RECONNECT_MS = 1_200;
export const LOG_STREAM_RECONNECT_MAX_MS = 30_000;

/** Delay before reconnect try number `attempt` (1-based). */
export function logStreamReconnectDelay(attempt: number) {
  const step = Math.max(0, attempt - 1);
  return Math.min(LOG_STREAM_RECONNECT_MS * 2 ** step, LOG_STREAM_RECONNECT_MAX_MS);
}

/**
 * Why a log stream will not get new lines, or null while it can. A finished pod
 * (a Job's pod, for example) closes `kubectl logs -f` at once: reconnecting every
 * second left the tab on "Reconnecting..." for good.
 */
export function logStreamEndReason(
  pod: Partial<PodItem> | null | undefined,
  container: string,
): string | null {
  const phase = pod?.status?.phase;
  if (phase === "Succeeded" || phase === "Failed") {
    return `Stream ended: the pod has ${phase === "Succeeded" ? "completed" : "failed"}.`;
  }
  // A container that will not start again: terminated and the pod never restarts it.
  // PodSpec does not type restartPolicy; it defaults to Always.
  const restartPolicy = (pod?.spec as { restartPolicy?: string } | undefined)?.restartPolicy;
  if (restartPolicy !== "Never") return null;
  const statuses = pod?.status?.containerStatuses ?? [];
  const watched =
    !container || container === ALL_CONTAINERS
      ? statuses
      : statuses.filter((status) => status.name === container);
  if (watched.length > 0 && watched.every((status) => Boolean(status.state.terminated))) {
    return "Stream ended: the container has exited.";
  }
  return null;
}
