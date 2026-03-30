export interface DeploymentRevision {
  revision: number;
  changeCause: string;
  summary?: string;
  pods?: string;
  age?: string;
  replicaSet?: string;
}

export interface DeploymentHistoryResult {
  revisions: DeploymentRevision[];
  currentRevision?: number;
}
