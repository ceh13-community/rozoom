import { derived, writable, type Readable } from "svelte/store";
import { eventBus } from "../event-bus";
import type { ConfigurationWatchEvent } from "./configuration-parser";
import type { WorkloadType } from "$shared/model/workloads";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

type GenericItem = Record<string, unknown>;

type ConfigurationWatchPayload = {
  workloadType: WorkloadType;
  event: ConfigurationWatchEvent;
};

const store = writable<Record<string, GenericItem[]>>({});

function makeScopeKey(clusterId: string, workloadType: WorkloadType) {
  return `${clusterId}:${workloadType}`;
}

function getItemId(item: GenericItem) {
  const metadata = (item.metadata ?? {}) as { namespace?: string; name?: string };
  return `${metadata.namespace ?? "cluster"}/${metadata.name ?? "unknown"}`;
}

function mergeEvent(scopeKey: string, watchEvent: ConfigurationWatchEvent) {
  store.update((current) => {
    const items = current[scopeKey] ?? [];
    const itemId = getItemId(watchEvent.object);

    switch (watchEvent.type) {
      case "ADDED":
      case "MODIFIED":
        return {
          ...current,
          [scopeKey]: [...items.filter((item) => getItemId(item) !== itemId), watchEvent.object],
        };
      case "DELETED":
        return {
          ...current,
          [scopeKey]: items.filter((item) => getItemId(item) !== itemId),
        };
      default:
        return current;
    }
  });
}

eventBus.subscribe((event) => {
  if (event.kind !== "configuration") return;
  const payload = event.payload as ConfigurationWatchPayload;
  mergeEvent(makeScopeKey(event.clusterId, payload.workloadType), payload.event);
  acknowledgeMutationAck(
    event.clusterId,
    `configuration:${payload.workloadType}`,
    getItemId(payload.event.object),
    payload.event.type,
  );
});

export const configurationItemsStore = store;

export function selectClusterConfigurationItems(
  clusterId: string,
  workloadType: WorkloadType,
): Readable<GenericItem[]> {
  return derived(store, ($store) => $store[makeScopeKey(clusterId, workloadType)] ?? []);
}

export function setInitialConfigurationItems(
  clusterId: string,
  workloadType: WorkloadType,
  items: GenericItem[],
) {
  store.update((current) => ({
    ...current,
    [makeScopeKey(clusterId, workloadType)]: items,
  }));
}

export function applyConfigurationItemEvent(
  clusterId: string,
  workloadType: WorkloadType,
  event: ConfigurationWatchEvent,
) {
  mergeEvent(makeScopeKey(clusterId, workloadType), event);
}
