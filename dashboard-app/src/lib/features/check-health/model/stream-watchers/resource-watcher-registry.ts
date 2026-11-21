import { KubectlWatcher } from "./watcher-model";
import { buildKubectlWatchCommand } from "./watch-command";
import { reportWatcherRuntimeError } from "./watcher-runtime-error";
import type { EventParser } from "./watcher-parser";

export function createResourceWatcherRegistry(command: string, parser: EventParser) {
  const active = new Map<string, KubectlWatcher>();
  const watchCommand = buildKubectlWatchCommand(command);

  return {
    start(clusterId: string) {
      if (active.has(clusterId)) return;
      const watcher = new KubectlWatcher();
      active.set(clusterId, watcher);
      void watcher.start(
        watchCommand,
        clusterId,
        (err) => {
          reportWatcherRuntimeError({ clusterId, kind: command }, err);
        },
        parser,
      );
    },
    stop(clusterId: string) {
      const watcher = active.get(clusterId);
      if (!watcher) return;
      void watcher.stop();
      active.delete(clusterId);
    },
  };
}
