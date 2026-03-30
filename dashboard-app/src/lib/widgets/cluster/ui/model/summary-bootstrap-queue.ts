const SUMMARY_BOOTSTRAP_GAP_MS = 150;

const clusterBootstrapTail = new Map<string, Promise<void>>();
const inFlightBootstraps = new Map<string, Promise<void>>();

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function scheduleSummaryBootstrap(
  clusterId: string,
  summaryKey: string,
  task: () => Promise<void>,
): Promise<void> {
  const requestKey = `${clusterId}:${summaryKey}`;
  const inFlight = inFlightBootstraps.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const hasQueuedClusterTask = clusterBootstrapTail.has(clusterId);
  const previous = clusterBootstrapTail.get(clusterId) ?? Promise.resolve();
  const scheduled = previous
    .catch(() => undefined)
    .then(async () => {
      if (hasQueuedClusterTask) {
        await sleep(SUMMARY_BOOTSTRAP_GAP_MS);
      }
      await task();
    })
    .finally(() => {
      if (inFlightBootstraps.get(requestKey) === scheduled) {
        inFlightBootstraps.delete(requestKey);
      }
    });

  inFlightBootstraps.set(requestKey, scheduled);
  clusterBootstrapTail.set(
    clusterId,
    scheduled.finally(() => {
      if (clusterBootstrapTail.get(clusterId) === scheduled) {
        clusterBootstrapTail.delete(clusterId);
      }
    }),
  );

  return scheduled;
}

export function resetSummaryBootstrapQueue() {
  clusterBootstrapTail.clear();
  inFlightBootstraps.clear();
}
