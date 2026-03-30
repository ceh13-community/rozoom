import { derived, writable, type Readable } from "svelte/store";
import { KubectlWatcher } from "../watcher-model";
import { buildKubectlWatchCommand } from "../watch-command";

const active = new Map<string, KubectlWatcher>();
const watcherErrors = writable<Record<string, string | null>>({});
const WARNING_EVENTS_WATCH_COMMAND = buildKubectlWatchCommand(
  "get events --all-namespaces --field-selector type=Warning -o json",
);

function setWatcherError(clusterId: string, error: string | null) {
  if (!clusterId) return;
  watcherErrors.update((state) => ({
    ...state,
    [clusterId]: error,
  }));
}

export function isOverviewWarningEventsWatcherActive(clusterId: string): boolean {
  return active.has(clusterId);
}

export function selectOverviewWarningEventsWatcherError(
  clusterId: string,
): Readable<string | null> {
  return derived(watcherErrors, ($errors) => $errors[clusterId] ?? null);
}

export function getOverviewWarningEventsWatcherError(clusterId: string): string | null {
  let value: string | null = null;
  const unsubscribe = selectOverviewWarningEventsWatcherError(clusterId).subscribe((next) => {
    value = next;
  });
  unsubscribe();
  return value;
}

export function startOverviewWarningEventsWatcher(clusterId: string) {
  if (!clusterId || active.has(clusterId)) return;

  const watcher = new KubectlWatcher();
  active.set(clusterId, watcher);
  setWatcherError(clusterId, null);

  void watcher
    .start(WARNING_EVENTS_WATCH_COMMAND, clusterId, (err) => {
      setWatcherError(clusterId, err || "Warning events watcher failed.");
    })
    .catch((error: unknown) => {
      active.delete(clusterId);
      setWatcherError(
        clusterId,
        error instanceof Error ? error.message : "Warning events watcher unavailable.",
      );
    });
}

export function stopOverviewWarningEventsWatcher(clusterId: string) {
  const watcher = active.get(clusterId);
  if (!watcher) return;

  void watcher.stop();
  active.delete(clusterId);
  setWatcherError(clusterId, null);
}
