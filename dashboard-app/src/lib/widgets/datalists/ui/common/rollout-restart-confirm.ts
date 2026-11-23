import { confirmAction } from "$shared/lib/confirm-action";

// A rollout restart recreates every pod of the workload, so it asks first and names the
// command, the same way a delete does. One rule for deployments, stateful sets and daemon sets.

export type RolloutRestartKind = "deployment" | "statefulset" | "daemonset";

export type RolloutRestartTarget = {
  name: string;
  namespace: string;
};

const KIND_LABEL: Record<RolloutRestartKind, { one: string; many: string }> = {
  deployment: { one: "deployment", many: "deployments" },
  statefulset: { one: "stateful set", many: "stateful sets" },
  daemonset: { one: "daemon set", many: "daemon sets" },
};

/** The kubectl arguments the restart runs for one target, without the binary. */
export function rolloutRestartCommand(kind: RolloutRestartKind, target: RolloutRestartTarget) {
  return `rollout restart ${kind}/${target.name} --namespace ${target.namespace}`;
}

export function describeRolloutRestart(kind: RolloutRestartKind, targets: RolloutRestartTarget[]) {
  const label = KIND_LABEL[kind];
  const head =
    targets.length === 1
      ? `Restart the rollout of ${label.one} ${targets[0].namespace}/${targets[0].name}? Every pod of it is recreated.`
      : `Restart the rollout of ${targets.length} ${label.many}? Every pod of them is recreated.`;
  const commands = targets.map((target) => `kubectl ${rolloutRestartCommand(kind, target)}`);
  return `${head}\n\n${commands.join("\n")}`;
}

/** Asks before a rollout restart. Resolves true only on an explicit confirm. */
export function confirmRolloutRestart(kind: RolloutRestartKind, targets: RolloutRestartTarget[]) {
  if (targets.length === 0) return Promise.resolve(false);
  return confirmAction(describeRolloutRestart(kind, targets), "Rollout restart");
}

/** Name and namespace of the items that can be restarted; items without a name are skipped. */
export function rolloutRestartTargets(
  items: { metadata?: { name?: string; namespace?: string } | null }[],
): RolloutRestartTarget[] {
  return items.flatMap((item) => {
    const name = item.metadata?.name;
    return name ? [{ name, namespace: item.metadata?.namespace ?? "default" }] : [];
  });
}
