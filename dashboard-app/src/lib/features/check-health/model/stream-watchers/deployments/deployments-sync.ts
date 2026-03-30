import type { DeploymentItem } from "$shared";
import { initWatchParsers } from "../register-parsers";
import { setInitialDeployments } from "./deployments-store";
import { startDeploymentsWatcher, stopDeploymentsWatcher } from "./deployments-watcher";
import { createApiResourceSync } from "../../api-sync/api-resource-sync";

const deploymentsApiSync = createApiResourceSync<Partial<DeploymentItem>>({
  getPath: () => "/apis/apps/v1/deployments",
  kind: "deployment",
  setInitial: setInitialDeployments,
  fallbackStart: startDeploymentsWatcher,
  fallbackStop: stopDeploymentsWatcher,
});

export function initDeploymentsSync(clusterId: string, initialItems?: Partial<DeploymentItem>[]) {
  initWatchParsers();
  if (initialItems?.length) {
    setInitialDeployments(clusterId, initialItems);
  }
  deploymentsApiSync.start(clusterId);
}

export function destroyDeploymentsSync(clusterId: string) {
  deploymentsApiSync.stop(clusterId);
}
