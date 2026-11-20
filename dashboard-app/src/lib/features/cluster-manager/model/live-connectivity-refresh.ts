import type { ClusterConnectivity } from "$shared/model/cluster-connectivity";

/** How often the manage page re-checks clusters it already knows about. */
export const MANAGER_CONNECTIVITY_REFRESH_MS = 30_000;
const MAX_PARALLEL_CHECKS = 4;

/**
 * The managed clusters the manage page re-checks on its own: only those that
 * already answered, or stopped answering with a definite error, in this session.
 * Never re-checked here: a cluster nothing has talked to yet (unknown), an expired
 * credential, and a cluster whose last check got no answer at all. The last one is
 * what a credential plugin waiting for a person looks like (browser login, device
 * code): checking it again would start that login again every round. Those wait
 * for Retry or for the user to open the cluster.
 */
export function clustersToRecheck(
  clusters: ReadonlyArray<{ uuid: string; offline?: boolean }>,
  connectivity: Readonly<Record<string, ClusterConnectivity | undefined>>,
): string[] {
  return clusters
    .filter((cluster) => !cluster.offline)
    .map((cluster) => cluster.uuid)
    .filter((uuid) => {
      const entry = connectivity[uuid];
      if (!entry || entry.noAnswer) return false;
      return entry.state === "online" || entry.state === "unreachable";
    });
}

export type ConnectivityRefresh = {
  /** Runs a round now, for example when the window becomes visible again. */
  runNow: () => void;
  stop: () => void;
};

/**
 * Re-checks the picked clusters once now and then on an interval, a few at a
 * time, skipping a round while the window is hidden or the last round still
 * runs.
 */
export function startConnectivityRefresh(options: {
  pickClusterIds: () => string[];
  check: (clusterId: string) => Promise<unknown>;
  isPageVisible?: () => boolean;
  intervalMs?: number;
}): ConnectivityRefresh {
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
  return {
    runNow: () => {
      void runRound();
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
