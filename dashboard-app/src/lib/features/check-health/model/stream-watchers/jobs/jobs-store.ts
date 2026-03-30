import { createResourceStore } from "$shared/model/resource-store";
import type { JobItem } from "$shared/model/clusters";
import type { JobWatchEvent } from "./jobs-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

function getJobStoreId(item: Partial<JobItem>) {
  return `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "unknownJob"}`;
}

const jobStore = createResourceStore<Partial<JobItem>>({
  getId: getJobStoreId,
});

function applyJobEventInternal(
  clusterId: string,
  event: JobWatchEvent,
  origin: "watch" | "optimistic",
) {
  jobStore.apply(clusterId, event);
  if (origin === "watch") {
    acknowledgeMutationAck(clusterId, "job", getJobStoreId(event.object), event.type);
  }
}

eventBus.subscribe((event) => {
  if (event.kind !== "job") return;
  applyJobEventInternal(event.clusterId, event.payload as JobWatchEvent, "watch");
});

export const jobsStore = jobStore.store;
export const setInitialJobs = jobStore.setInitial;
export function applyJobEvent(clusterId: string, event: JobWatchEvent) {
  applyJobEventInternal(clusterId, event, "optimistic");
}

export function selectClusterJobs(clusterId: string): Readable<Partial<JobItem>[]> {
  return derived(jobsStore, ($store) => $store[clusterId] ?? []);
}
