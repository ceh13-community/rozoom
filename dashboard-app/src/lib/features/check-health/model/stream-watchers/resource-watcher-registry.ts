import { KubectlWatcher } from "./watcher-model";
import { buildKubectlWatchCommand } from "./watch-command";
import { reportWatcherRuntimeError } from "./watcher-runtime-error";

export function createResourceWatcherRegistry(command: string) {
  const active = new Map<string, KubectlWatcher>();
  const watchCommand = buildKubectlWatchCommand(command);

  return {
    start(clusterId: string) {
      if (active.has(clusterId)) return;
      const watcher = new KubectlWatcher();
      active.set(clusterId, watcher);
      void watcher.start(watchCommand, clusterId, (err) => {
        reportWatcherRuntimeError({ clusterId, kind: command }, err);
      });
    },
    stop(clusterId: string) {
      const watcher = active.get(clusterId);
      if (!watcher) return;
      void watcher.stop();
      active.delete(clusterId);
    },
  };
}
