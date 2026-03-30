import { KUBECTL_COMMANDS } from "$shared/config/kubectl-commands";
import type { WorkloadType } from "$shared/model/workloads";
import { KubectlWatcher } from "../watcher-model";
import { buildKubectlWatchCommand } from "../watch-command";
import { reportWatcherRuntimeError } from "../watcher-runtime-error";

const active = new Map<string, KubectlWatcher>();

function makeScopeKey(clusterId: string, workloadType: WorkloadType) {
  return `${clusterId}:${workloadType}`;
}

function buildWatchCommand(workloadType: WorkloadType) {
  const base = KUBECTL_COMMANDS[workloadType];
  if (!base) return null;
  const resolved = base.includes("${ns}") ? base.replace("${ns}", "--all-namespaces") : base;
  return buildKubectlWatchCommand(`${resolved} -o json`);
}

export function startConfigurationWatcher(clusterId: string, workloadType: WorkloadType) {
  const key = makeScopeKey(clusterId, workloadType);
  if (active.has(key)) return;
  const command = buildWatchCommand(workloadType);
  if (!command) return;
  const watcher = new KubectlWatcher();
  active.set(key, watcher);
  void watcher.start(command, clusterId, (error) => {
    reportWatcherRuntimeError({ clusterId, kind: workloadType }, error);
  });
}

export function stopConfigurationWatcher(clusterId: string, workloadType: WorkloadType) {
  const key = makeScopeKey(clusterId, workloadType);
  const watcher = active.get(key);
  if (!watcher) return;
  void watcher.stop();
  active.delete(key);
}
