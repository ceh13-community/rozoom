export interface KubectlVersion {
  serverVersion: {
    gitVersion: string;
  };
  clientVersion: {
    gitVersion: string;
  };
}
