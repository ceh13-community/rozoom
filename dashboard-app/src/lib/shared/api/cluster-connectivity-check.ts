import {
  getClusterConnectivity,
  recordServerVersion,
  reportClusterLoadError,
  reportClusterNoAnswer,
  setClusterConnectivityChecking,
  type ClusterConnectivity,
} from "$shared/model/cluster-connectivity";
import { kubectlRawArgsFront } from "./kubectl-proxy";

/**
 * Upper bound for one check. The request itself has --request-timeout=5s; the
 * bound only has to catch a credential plugin that never returns.
 */
export const CONNECTIVITY_CHECK_TIMEOUT_MS = 35_000;

const inFlight = new Map<string, Promise<ClusterConnectivity>>();

function parseGitVersion(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { gitVersion?: unknown };
    return typeof parsed.gitVersion === "string" ? parsed.gitVersion : null;
  } catch {
    return null;
  }
}

/**
 * Asks the API server of a cluster for its version. This runs the cluster's
 * credential plugin if it has one, so callers only run it on a user action:
 * opening the cluster page or pressing Retry. The kubectl proxy records the
 * verdict; this function only adds the timeout and the version.
 *
 * One check per cluster at a time: a second call joins the running one.
 */
export function checkClusterConnectivity(clusterId: string): Promise<ClusterConnectivity> {
  const running = inFlight.get(clusterId);
  if (running) return running;

  const check = (async () => {
    setClusterConnectivityChecking(clusterId, true);
    const controller = new AbortController();
    // Object, not a boolean: the flag is set inside the timer closure, which
    // TypeScript's flow analysis cannot see.
    const timedOut = { value: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The race ends the check even where the call ignores the abort signal.
    const giveUp = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut.value = true;
        controller.abort();
        reject(new Error("connectivity check timed out"));
      }, CONNECTIVITY_CHECK_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        kubectlRawArgsFront(["get", "--raw", "/version", "--request-timeout=5s"], {
          clusterId,
          signal: controller.signal,
          source: "cluster-connectivity:check",
        }),
        giveUp,
      ]);
      const answered = result.code === undefined || result.code === 0;
      const version = answered ? parseGitVersion(result.output) : null;
      if (version) recordServerVersion(clusterId, version);
    } catch (error) {
      if (timedOut.value) {
        reportClusterNoAnswer(
          clusterId,
          `Gave up after ${Math.round(CONNECTIVITY_CHECK_TIMEOUT_MS / 1000)} s: kubectl did not return. Its credential plugin may still be running.`,
        );
      } else {
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        reportClusterLoadError(clusterId, message);
      }
    } finally {
      clearTimeout(timer);
      setClusterConnectivityChecking(clusterId, false);
      inFlight.delete(clusterId);
    }
    return getClusterConnectivity(clusterId);
  })();
  inFlight.set(clusterId, check);
  return check;
}
