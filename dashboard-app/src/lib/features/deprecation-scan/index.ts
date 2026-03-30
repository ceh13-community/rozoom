export {
  deprecationScanConfig,
  deprecationScanState,
  deprecationScanTargetVersionByCluster,
  getTrustLevelLabel,
  markScanUnavailable,
  runDeprecationScan,
  setDeprecationScanTargetVersion,
  startDeprecationScanPolling,
  stopAllDeprecationScanPolling,
  stopDeprecationScanPolling,
} from "./model/store";
export type {
  ClusterDeprecationScanState,
  DeprecationIssue,
  DeprecationScanConfig,
  DeprecationScanRun,
  DeprecationScanSummary,
  DeprecationTrustLevel,
  DeprecationStatus,
} from "./model/types";
