import { createResourceStore } from "$shared/model/resource-store";
import type { CronJobItem } from "$shared/model/clusters";
import type { CronJobWatchEvent } from "./cronjobs-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

function getCronJobStoreId(item: Partial<CronJobItem>) {
  return `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "unknownCronJob"}`;
}

const cronJobStore = createResourceStore<Partial<CronJobItem>>({
  getId: getCronJobStoreId,
});

function applyCronJobEventInternal(
  clusterId: string,
  event: CronJobWatchEvent,
  origin: "watch" | "optimistic",
) {
  cronJobStore.apply(clusterId, event);
  if (origin === "watch") {
    acknowledgeMutationAck(clusterId, "cronjob", getCronJobStoreId(event.object), event.type);
  }
}

eventBus.subscribe((event) => {
  if (event.kind !== "cronjob") return;
  applyCronJobEventInternal(event.clusterId, event.payload as CronJobWatchEvent, "watch");
});

export const cronJobsStore = cronJobStore.store;
export const setInitialCronJobs = cronJobStore.setInitial;
export function applyCronJobEvent(clusterId: string, event: CronJobWatchEvent) {
  applyCronJobEventInternal(clusterId, event, "optimistic");
}

export function selectClusterCronJobs(clusterId: string): Readable<Partial<CronJobItem>[]> {
  return derived(cronJobsStore, ($store) => $store[clusterId] ?? []);
}
