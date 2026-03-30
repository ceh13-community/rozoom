import { resetUnreachableEntries } from "$features/check-health/model/feature-capability-cache";
import { restartFailedWatchers } from "$features/check-health/model/watchers";
import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";

let cleanup: (() => void) | null = null;

function handleOnline() {
  void writeRuntimeDebugLog("network-recovery", "online_detected");
  resetUnreachableEntries();
  restartFailedWatchers();
}

export function initNetworkRecoveryListener(): () => void {
  if (typeof window === "undefined") return () => {};
  if (cleanup) return cleanup;

  window.addEventListener("online", handleOnline);
  cleanup = () => {
    window.removeEventListener("online", handleOnline);
    cleanup = null;
  };
  return cleanup;
}
