import * as Sentry from "@sentry/sveltekit";
import { error } from "@tauri-apps/plugin-log";
import { kubectlJson, kubectlRawFront } from "$shared/api/kubectl-proxy";
import { parseRevisionDetails, parseRolloutHistory } from "../ui/formatters";
import type { DeploymentItem, ReplicaSets } from "$shared/model/clusters";

export async function getDeploymentRevisionDetails(
  clusterId: string,
  deployment: string,
  namespace: string,
  revision: number,
) {
  try {
    const details = await kubectlRawFront(
      `rollout history deployment/${deployment} -n ${namespace} --revision=${revision}`,
      { clusterId },
    );

    if (!details.output) return null;

    return parseRevisionDetails(details.output);
  } catch (err) {
    const errorToLog = `Error fetching revision ${revision} details: ${err}`;
    await error(errorToLog);
    Sentry.captureException(errorToLog);
    console.error(errorToLog);

    return null;
  }
}

export async function rolloutDeploymentHistory(
  clusterId: string,
  deployment: string,
  namespace = "default",
) {
  try {
    const historyOutput = await kubectlRawFront(
      `rollout history deployment/${deployment} -n ${namespace}`,
      { clusterId },
    );

    if (!historyOutput.output) return undefined;

    const deploymentInfo = (await kubectlJson(`get deployment/${deployment} -n ${namespace}`, {
      clusterId,
    })) as DeploymentItem;
    const currentRevision = parseInt(
      deploymentInfo.metadata.annotations?.["deployment.kubernetes.io/revision"] || "0",
    );

    const replicaSets = (await kubectlJson(
      `get rs -n ${namespace} -l app=${deploymentInfo.metadata.labels?.app || deployment}`,
      {
        clusterId,
      },
    )) as ReplicaSets;

    const revisions = parseRolloutHistory(historyOutput.output, replicaSets.items);

    return {
      revisions,
      currentRevision,
    };
  } catch (err) {
    const errorToLog = `Error fetching deployment history: ${err}`;
    await error(errorToLog);
    Sentry.captureException(errorToLog);
    console.error("Error fetching deployment history:", err);
  }
}
