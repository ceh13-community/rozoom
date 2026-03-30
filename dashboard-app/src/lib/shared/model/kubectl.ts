export type KubectlOptions = {
  namespace?: string;
  clusterId?: string;
  signal?: AbortSignal;
  source?: string;
  allowCommandUnavailable?: boolean;
  notify?: boolean;
};
