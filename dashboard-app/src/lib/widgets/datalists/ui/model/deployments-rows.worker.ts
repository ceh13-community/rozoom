import { mapDeploymentRows } from "../deployments-list/model/map-deployment-rows";

type DeploymentInput = {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string | Date;
  };
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        nodeName?: string;
        nodeSelector?: Record<string, string>;
      };
    };
  };
  status?: {
    readyReplicas?: number;
    replicas?: number;
    availableReplicas?: number;
  };
};

type DeploymentsRowsWorkerRequest = {
  id: number;
  enqueuedAt: number;
  deployments: DeploymentInput[];
};

type DeploymentsRowsWorkerResponse = {
  id: number;
  enqueuedAt: number;
  startedAt: number;
  finishedAt: number;
  rows: ReturnType<typeof mapDeploymentRows>;
};

self.onmessage = (event: MessageEvent<DeploymentsRowsWorkerRequest>) => {
  const { id, enqueuedAt, deployments } = event.data;
  const startedAt = Date.now();
  const rows = mapDeploymentRows(deployments);
  const finishedAt = Date.now();
  const response: DeploymentsRowsWorkerResponse = {
    id,
    enqueuedAt,
    startedAt,
    finishedAt,
    rows,
  };
  self.postMessage(response);
};

export {};
