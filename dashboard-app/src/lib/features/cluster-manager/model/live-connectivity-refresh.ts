import type { ClusterConnectivity } from "$shared/model/cluster-connectivity";

/** How often the manage page re-checks clusters it already knows about. */
export const MANAGER_CONNECTIVITY_REFRESH_MS = 30_000;
const MAX_PARALLEL_CHECKS = 4;

/**
 * The managed clusters the manage page re-checks on its own: only those that
 * already answered, or stopped answering, in this session. A cluster nothing has
 * talked to yet stays unknown until the user opens it, and an expired credential
 * is not retried in the background, so no credential plugin runs here that the
 * user has not already run.
 */
export function clustersToRecheck(
  clusters: ReadonlyArray<{ uuid: string; offline?: boolean }>,
  connectivity: Readonly<Record<string, ClusterConnectivity | undefined>>,
): string[] {
  return clusters
    .filter((cluster) => !cluster.offline)
    .map((cluster) => cluster.uuid)
    .filter((uuid) => {
      const state = connectivity[uuid]?.state;
      return state === "online" || state === "unreachable";
    });
}

/**
 * Re-checks the picked clusters once now and then on an interval, a few at a
 * time, skipping a round while the window is hidden or the last round still
 * runs. Returns the stop function.
 */
export function startConnectivityRefresh(options: {
  pickClusterIds: () => string[];
  check: (clusterId: string) => Promise<unknown>;
  isPageVisible?: () => boolean;
  intervalMs?: number;
}): () => void {
  let stopped = false;
  let running = false;

  async function runRound() {
    if (stopped || running) return;
    if (options.isPageVisible && !options.isPageVisible()) return;
    running = true;
    try {
      const queue = [...options.pickClusterIds()];
      const worker = async () => {
        while (!stopped && queue.length > 0) {
          const clusterId = queue.shift();
          if (clusterId) await options.check(clusterId).catch(() => undefined);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_PARALLEL_CHECKS, queue.length) }, worker),
      );
    } finally {
      running = false;
    }
  }

  void runRound();
  const timer = setInterval(() => {
    void runRound();
  }, options.intervalMs ?? MANAGER_CONNECTIVITY_REFRESH_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
