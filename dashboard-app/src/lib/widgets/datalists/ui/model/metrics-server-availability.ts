/**
 * Per-cluster session cache for metrics-server availability.
 *
 * The overview's resource-pressure fallback runs `kubectl get pods -A` so it
 * can compute requests-vs-allocatable when metrics-server is absent. On large
 * clusters that list is expensive. Once we have observed metrics-server
 * responding with data for a cluster, we can skip the pod fetch on the next
 * refresh and re-check on a cooldown instead.
 *
 * This cache lives in-memory for the app session. It is cleared implicitly
 * when the app restarts, and can be cleared explicitly via forgetCluster()
 * when the user reconnects or changes kubeconfig context.
 */

type Availability = "available" | "unavailable";

interface Entry {
  state: Availability;
  at: number;
}

const cache = new Map<string, Entry>();

/**
 * After this many ms we re-probe metrics-server even if we last saw it
 * available. Protects against users uninstalling the controller or HPA
 * blowing up mid-session.
 */
const REFRESH_AFTER_MS = 10 * 60 * 1000;

export function recordMetricsServerAvailable(clusterId: string, now = Date.now()): void {
  cache.set(clusterId, { state: "available", at: now });
}

export function recordMetricsServerUnavailable(clusterId: string, now = Date.now()): void {
  cache.set(clusterId, { state: "unavailable", at: now });
}

/**
 * True when the most recent probe for this cluster saw metrics-server working
 * and the observation is still fresh. Callers can skip the expensive pod
 * fallback query when this returns true.
 */
export function isMetricsServerKnownAvailable(clusterId: string, now = Date.now()): boolean {
  const entry = cache.get(clusterId);
  if (!entry || entry.state !== "available") return false;
  return now - entry.at < REFRESH_AFTER_MS;
}

export function forgetCluster(clusterId: string): void {
  cache.delete(clusterId);
}

export function resetMetricsServerAvailabilityCacheForTests(): void {
  cache.clear();
}
