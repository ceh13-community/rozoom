/**
 * Classifies kubectl invocations as resource mutations for WAU-C telemetry.
 *
 * Core Action #3 (rozoom_resource_action_taken) means the user changed
 * cluster state — restart, scale, delete, apply — not that they looked at it.
 * Reads (get/describe/logs/top/rollout status) must never count, otherwise
 * background pollers would inflate the metric. Spec: state/wau-c-spec.md §4.
 *
 * Callers in this app always build kubectl args verb-first (flags follow),
 * so the first argument is the verb. `rollout` is split because only some of
 * its subcommands mutate (restart/undo/pause/resume vs status/history).
 */
const MUTATING_VERBS = new Set([
  "annotate",
  "apply",
  "autoscale",
  "cordon",
  "create",
  "delete",
  "drain",
  "edit",
  "expose",
  "label",
  "patch",
  "replace",
  "run",
  "scale",
  "set",
  "taint",
  "uncordon",
]);

const MUTATING_ROLLOUT_SUBCOMMANDS = new Set(["restart", "undo", "pause", "resume"]);

export function isMutatingKubectlCommand(args: readonly string[]): boolean {
  const verb = args[0]?.trim().toLowerCase();
  if (!verb) return false;
  if (verb === "rollout") {
    const subcommand = args[1]?.trim().toLowerCase();
    return subcommand ? MUTATING_ROLLOUT_SUBCOMMANDS.has(subcommand) : false;
  }
  return MUTATING_VERBS.has(verb);
}
