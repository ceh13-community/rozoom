import { STATUS_CLASSES } from "../../../entities/cluster/model/constants";
import { hasErrors, hasNoNodesData, hasWarnings, isCritical } from "../model/get-statuses";
import type { ClusterCheckError, ClusterHealthChecks } from "../model/types";

export function getColorForClusterCard(checks: ClusterHealthChecks | ClusterCheckError | null) {
  if (hasErrors(checks)) {
    return { color: STATUS_CLASSES.unknown, text: "Unknown" };
  }

  if (hasNoNodesData(checks)) {
    return { color: STATUS_CLASSES.unknown, text: "Unknown" };
  }

  const healthChecks = checks as ClusterHealthChecks;

  if (isCritical(healthChecks)) {
    return { color: STATUS_CLASSES.error, text: "Critical" };
  }

  if (hasWarnings(healthChecks)) {
    return { color: STATUS_CLASSES.warning, text: "Warning" };
  }

  return { color: STATUS_CLASSES.ok, text: "Ok" };
}
