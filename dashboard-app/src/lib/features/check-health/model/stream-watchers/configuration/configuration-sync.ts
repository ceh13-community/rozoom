import type { WorkloadType } from "$shared/model/workloads";
import { initWatchParsers } from "../register-parsers";
import { setInitialConfigurationItems } from "./configuration-store";
import { startConfigurationWatcher, stopConfigurationWatcher } from "./configuration-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";
import { getConfigurationApiPaths } from "../../api-sync/configuration-api-paths";

type GenericItem = Record<string, unknown>;

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
