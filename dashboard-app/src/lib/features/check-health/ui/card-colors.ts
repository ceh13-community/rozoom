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

export type ClusterCardState = { color: string; text: string; tooltip: string };

/**
 * One rule for the colour, the word and the tooltip of a cluster card: the
 * Compact and the Detailed card both paint their header and their status badge
 * from it, so a cluster never looks grey in one density and red in the other.
 * Order: the user's Paused setting, then a cluster that does not answer, then
 * a check that has not run yet, then the verdict of the last check.
 */
export function displayClusterCardState(input: {
  linterOn: boolean;
  disconnected: boolean;
  connectivityTitle: string;
  connectivityReason?: string | null;
  awaitingInitialRefresh: boolean;
  base: { color: string; text: string };
}): ClusterCardState {
  if (!input.linterOn) {
    return {
      color: "bg-slate-600",
      text: "Paused",
      tooltip:
        "Linter is off for this cluster - diagnostics won't run. Click the gauge icon to turn it on.",
    };
  }
  if (input.disconnected) {
    return {
      color: "bg-slate-600",
      text: input.connectivityTitle,
      tooltip: input.connectivityReason ?? "",
    };
  }
  if (input.awaitingInitialRefresh) {
    return {
      color: "bg-slate-500",
      text: "Pending",
      tooltip: "Waiting for initial health check. Click the refresh button to start.",
    };
  }
  const { base } = input;
  const tooltip =
    base.text === "Ok"
      ? "All health checks passed. Cluster is healthy."
      : base.text === "Warning"
        ? "Some health checks have warnings. Review the diagnostics for details."
        : base.text === "Critical"
          ? "Critical issues detected. Immediate attention recommended."
          : "Cluster status could not be determined. Run a health check to update.";
  return { ...base, tooltip };
}
