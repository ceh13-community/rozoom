import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type RolloutTarget = {
  resource: "deployment" | "daemonset" | "statefulset";
  name: string;
  namespace?: string;
};

export type RolloutCommandMode = "status" | "history";

export function buildRolloutCommandArgs(mode: RolloutCommandMode, target: RolloutTarget) {
  return [
    "rollout",
    mode,
    `${target.resource}/${target.name}`,
    "--namespace",
    target.namespace ?? "default",
  ];
}

export async function loadRolloutCommandOutput(
  clusterId: string,
  mode: RolloutCommandMode,
  target: RolloutTarget,
  signal?: AbortSignal,
) {
  const response = await kubectlRawArgsFront(buildRolloutCommandArgs(mode, target), {
    clusterId,
    signal,
  });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || `Failed to load rollout ${mode}.`);
  }
  return response.output || "";
}
