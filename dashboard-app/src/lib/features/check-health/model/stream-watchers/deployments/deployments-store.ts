import { createResourceStore } from "$shared/model/resource-store";
import type { DeploymentItem } from "$shared";
import type { DeploymentWatchEvent } from "./deployments-parser";
import { eventBus } from "../event-bus";
import { derived, type Readable } from "svelte/store";
import { acknowledgeMutationAck } from "../mutation-orchestrator";

function getDeploymentStoreId(item: Partial<DeploymentItem>) {
  return `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "unknownDeployment"}`;
}

const deploymentStore = createResourceStore<Partial<DeploymentItem>>({
  getId: getDeploymentStoreId,
});

function applyDeploymentEventInternal(
  clusterId: string,
  event: DeploymentWatchEvent,
  origin: "watch" | "optimistic",
) {
  deploymentStore.apply(clusterId, event);
  if (origin === "watch") {
    acknowledgeMutationAck(clusterId, "deployment", getDeploymentStoreId(event.object), event.type);
  }
}

eventBus.subscribe((event) => {
  if (event.kind !== "deployment") return;
  applyDeploymentEventInternal(event.clusterId, event.payload as DeploymentWatchEvent, "watch");
});

export const deploymentsStore = deploymentStore.store;
export const setInitialDeployments = deploymentStore.setInitial;
export function applyDeploymentEvent(clusterId: string, event: DeploymentWatchEvent) {
  applyDeploymentEventInternal(clusterId, event, "optimistic");
}

export function selectClusterDeployments(clusterId: string): Readable<Partial<DeploymentItem>[]> {
  return derived(deploymentsStore, ($store) => $store[clusterId] ?? []);
}
