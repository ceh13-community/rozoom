import type { WorkloadType } from "$shared/model/workloads";
import { initWatchParsers } from "../register-parsers";
import { setInitialConfigurationItems } from "./configuration-store";
import { startConfigurationWatcher, stopConfigurationWatcher } from "./configuration-watcher";
import { createApiResourceSync, selectResourceStreamLive } from "../../api-sync/api-resource-sync";
import { getConfigurationApiPaths } from "../../api-sync/configuration-api-paths";

type GenericItem = Record<string, unknown>;

function configurationStreamScope(workloadType: WorkloadType) {
  return `configuration:${workloadType}`;
}

export function selectConfigurationStreamLive(clusterId: string, workloadType: WorkloadType) {
  return selectResourceStreamLive(configurationStreamScope(workloadType), clusterId);
}

const configurationApiSyncByWorkload = new Map<
  WorkloadType,
  ReturnType<typeof createApiResourceSync<GenericItem>>
>();

function getConfigurationApiSync(workloadType: WorkloadType) {
  const existing = configurationApiSyncByWorkload.get(workloadType);
  if (existing) {
    return existing;
  }

  const sync = createApiResourceSync<GenericItem>({
    getPaths: () => getConfigurationApiPaths(workloadType),
    kind: "configuration",
    scope: configurationStreamScope(workloadType),
    setInitial: (clusterId, items) => {
      setInitialConfigurationItems(clusterId, workloadType, items);
    },
    fallbackStart: (clusterId) => {
      startConfigurationWatcher(clusterId, workloadType);
    },
    fallbackStop: (clusterId) => {
      stopConfigurationWatcher(clusterId, workloadType);
    },
  });
  configurationApiSyncByWorkload.set(workloadType, sync);
  return sync;
}

export function initConfigurationSync(
  clusterId: string,
  workloadType: WorkloadType,
  initialItems?: GenericItem[],
) {
  initWatchParsers();
  if (initialItems) {
    setInitialConfigurationItems(clusterId, workloadType, initialItems);
  }
  getConfigurationApiSync(workloadType).start(clusterId);
}

export function destroyConfigurationSync(clusterId: string, workloadType: WorkloadType) {
  getConfigurationApiSync(workloadType).stop(clusterId);
}
