export type KubectlOptions = {
  namespace?: string;
  clusterId?: string;
  signal?: AbortSignal;
  source?: string;
  allowCommandUnavailable?: boolean;
  notify?: boolean;
  /**
   * The app's own housekeeping (removing debug pods left by an earlier run): no CLI
   * notification, and not counted as a user action in telemetry.
   */
  housekeeping?: boolean;
};
