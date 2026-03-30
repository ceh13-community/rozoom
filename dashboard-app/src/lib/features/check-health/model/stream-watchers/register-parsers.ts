import { registerParser } from "./watcher-parser";
import { parsePodJsonLine } from "./pods/pods-parser";
import { parseNodeJsonLine } from "./nodes/nodes-parser";
import { parseDeploymentJsonLine } from "./deployments/deployments-parser";
import { parseDaemonSetJsonLine } from "./daemonsets/daemonsets-parser";
import { parseStatefulSetJsonLine } from "./statefulsets/statefulsets-parser";
import { parseReplicaSetJsonLine } from "./replicasets/replicasets-parser";
import { parseJobJsonLine } from "./jobs/jobs-parser";
import { parseCronJobJsonLine } from "./cronjobs/cronjobs-parser";
import { CONFIGURATION_WATCH_WORKLOADS } from "./configuration/configuration-workload-types";
import { createConfigurationJsonLineParser } from "./configuration/configuration-parser";
import { parseWarningEventJsonLine } from "./overview/warning-events-parser";

let registered = false;

export function initWatchParsers() {
  if (registered) return;

  registerParser(parsePodJsonLine);
  registerParser(parseNodeJsonLine);
  registerParser(parseDeploymentJsonLine);
  registerParser(parseDaemonSetJsonLine);
  registerParser(parseStatefulSetJsonLine);
  registerParser(parseReplicaSetJsonLine);
  registerParser(parseJobJsonLine);
  registerParser(parseCronJobJsonLine);
  for (const workloadType of CONFIGURATION_WATCH_WORKLOADS) {
    registerParser(createConfigurationJsonLineParser(workloadType));
  }
  registerParser(parseWarningEventJsonLine);

  registered = true;
}
