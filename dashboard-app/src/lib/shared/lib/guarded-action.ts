import type { AppClusterConfig } from "$entities/config";
import { checkActionSafety, type DestructiveAction } from "./cluster-safety";
import { confirmAction } from "./confirm-action";

/**
 * Run a destructive action with safety guards.
 *
 * 1. Checks if action is allowed on this cluster (read-only / prod)
 * 2. If blocked, shows reason and returns false
 * 3. If requires confirmation, shows dialog and waits
 * 4. If allowed, executes the action
 */
export async function guardedAction(
  cluster: Pick<AppClusterConfig, "readOnly" | "env" | "name">,
  action: DestructiveAction,
  execute: () => Promise<void>,
): Promise<boolean> {
  const check = checkActionSafety(cluster, action);

  if (!check.allowed) {
    await confirmAction(check.reason ?? "This action is not allowed.", "Blocked");
    return false;
  }

  if (check.requiresConfirmation) {
    const confirmed = await confirmAction(
      check.reason ?? "Are you sure you want to proceed?",
      "Confirm action",
    );
    if (!confirmed) return false;
  }

  await execute();
  return true;
}
