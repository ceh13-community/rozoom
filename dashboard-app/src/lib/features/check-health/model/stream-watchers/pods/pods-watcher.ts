import { KubectlWatcher } from "../watcher-model";
import { buildKubectlWatchCommand } from "../watch-command";
import { reportWatcherRuntimeError } from "../watcher-runtime-error";

const active = new Map<string, KubectlWatcher>();
const PODS_WATCH_COMMAND = buildKubectlWatchCommand("get pods --all-namespaces -o json");

export function startPodsWatcher(clusterId: string) {
  if (active.has(clusterId)) return;

  const watcher = new KubectlWatcher();

  active.set(clusterId, watcher);

  void watcher.start(PODS_WATCH_COMMAND, clusterId, (err) => {
    reportWatcherRuntimeError({ clusterId, kind: "pods" }, err);
  });
}

export function stopPodsWatcher(clusterId: string) {
  const watcher = active.get(clusterId);
  if (!watcher) return;

  void watcher.stop();
  active.delete(clusterId);
}
