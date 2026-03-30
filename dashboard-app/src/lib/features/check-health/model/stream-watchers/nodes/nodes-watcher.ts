import { KubectlWatcher } from "../watcher-model";
import { buildKubectlWatchCommand } from "../watch-command";
import { reportWatcherRuntimeError } from "../watcher-runtime-error";

const active = new Map<string, KubectlWatcher>();
const NODES_WATCH_COMMAND = buildKubectlWatchCommand("get nodes -o json");

export function startNodesWatcher(clusterId: string) {
  if (active.has(clusterId)) return;

  const watcher = new KubectlWatcher();

  active.set(clusterId, watcher);

  void watcher.start(NODES_WATCH_COMMAND, clusterId, (err) => {
    reportWatcherRuntimeError({ clusterId, kind: "nodes" }, err);
  });
}

export function stopNodesWatcher(clusterId: string) {
  const watcher = active.get(clusterId);
  if (!watcher) return;

  void watcher.stop();
  active.delete(clusterId);
}
