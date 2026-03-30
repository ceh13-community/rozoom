import { stopAllNodesHealthPolling } from "$features/check-health";
import { stopAllWatchers } from "$features/check-health/model/watchers";
import { resetActiveApiSyncClusters } from "$features/check-health/model/api-sync/api-sync-activity";
import { stopAllMetricsSourcesPolling } from "$features/metrics-sources";
import { stopAllBackupAuditPolling } from "$features/backup-audit";
import { stopAllVersionAuditPolling } from "$features/version-audit";
import { stopAllDeprecationScanPolling } from "$features/deprecation-scan";
import { stopAllAlertHubPolling } from "$features/alerts-hub";
import { stopAllArmorHubPolling } from "$features/armor-hub";
import { stopAllComplianceHubPolling } from "$features/compliance-hub";
import { stopNamespaceActivity } from "$features/namespace-management";
import { stopFleetHeartbeat } from "$features/check-health/api/fleet-heartbeat";
import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";

export function stopAllBackgroundPollers() {
  void writeRuntimeDebugLog("background-pollers", "stop_all");
  resetActiveApiSyncClusters();
  stopAllWatchers();
  stopAllNodesHealthPolling();
  stopAllMetricsSourcesPolling();
  stopAllBackupAuditPolling();
  stopAllVersionAuditPolling();
  stopAllDeprecationScanPolling();
  stopAllAlertHubPolling();
  stopAllArmorHubPolling();
  stopAllComplianceHubPolling();
  stopNamespaceActivity();
  stopFleetHeartbeat();
}
