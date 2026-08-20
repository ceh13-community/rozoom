// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllNodesHealthPolling } from "$features/check-health";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllWatchers } from "$features/check-health/model/watchers";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { resetActiveApiSyncClusters } from "$features/check-health/model/api-sync/api-sync-activity";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllMetricsSourcesPolling } from "$features/metrics-sources";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllBackupAuditPolling } from "$features/backup-audit";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllVersionAuditPolling } from "$features/version-audit";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllDeprecationScanPolling } from "$features/deprecation-scan";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllAlertHubPolling } from "$features/alerts-hub";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllArmorHubPolling } from "$features/armor-hub";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopAllComplianceHubPolling } from "$features/compliance-hub";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { stopNamespaceActivity } from "$features/namespace-management";
// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
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
