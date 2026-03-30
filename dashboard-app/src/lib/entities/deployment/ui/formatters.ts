import { timeAgo } from "$shared/lib/timeFormatters";
import { type DeploymentItem, type ReplicaSetItem } from "$shared/model/clusters";
import type { DeploymentRevision } from "../model/deployment";

export function getDeploymentStatus(
  deployment: DeploymentItem,
): "🏃Running" | "🕰️Pending" | "😔Failed" {
  const { status } = deployment;

  const available = status.conditions?.find((c) => c.type === "Available");
  const progressing = status.conditions?.find((c) => c.type === "Progressing");

  if (available?.status === "True" && progressing?.status === "True") {
    return "🏃Running";
  }

  if (progressing?.reason === "ProgressDeadlineExceeded") {
    return "😔Failed";
  }

  return "🕰️Pending";
}

export function getConditionType(condition: { type: string }): string {
  if (condition.type === "Ready") return "💪Ready";
  if (condition.type === "Progressing") return "🐌Progressing";
  if (condition.type === "Degraded") return "📉Degraded";
  if (condition.type === "Available") return "🍏Available";

  return condition.type;
}

export function parseRolloutHistory(
  historyOutput: string,
  replicaSets: ReplicaSetItem[],
): DeploymentRevision[] {
  const lines = historyOutput.split("\n");
  const revisions: DeploymentRevision[] = [];

  const dataLines = lines.slice(2).filter((line) => line.trim());

  dataLines.forEach((line) => {
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (match) {
      const revision = parseInt(match[1]);
      const changeCause = match[2] || "<none>";
      const relatedRS = replicaSets.find(
        (rs) =>
          rs.metadata.annotations?.["deployment.kubernetes.io/revision"] === revision.toString(),
      );
      const pods = relatedRS
        ? `${relatedRS.status.readyReplicas || 0}/${relatedRS.status.replicas || 0}`
        : "N/A";

      const age = relatedRS ? timeAgo(relatedRS.metadata.creationTimestamp) : "N/A";

      revisions.push({
        revision,
        changeCause,
        pods,
        age,
        replicaSet: relatedRS?.metadata.name,
      });
    }
  });

  return revisions.sort((a, b) => a.revision - b.revision);
}

export function parseRevisionDetails(detailsOutput: string): string {
  const lines = detailsOutput.split("\n");
  const relevantLines = lines.slice(2);
  return relevantLines.join("\n").trim();
}
