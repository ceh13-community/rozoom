import { toast } from "svelte-sonner";
import { confirmAction } from "$shared/lib/confirm-action";

// One close rule for every workbench: ask only when closing loses something
// that Undo cannot bring back: unsaved YAML edits or a running port-forward.
// Logs, events, rollout and clean YAML tabs close at once with an Undo toast.

export type WorkbenchTabCloseTarget = {
  kind: string;
  title: string;
  subtitle?: string | null;
  hasUnsavedChanges?: boolean;
  /** Closing this tab stops a running port-forward. */
  stopsPortForward?: boolean;
};

export const WORKBENCH_UNDO_TOAST_MS = 8000;

function normalizeKindLabel(kind: string) {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "yaml") return "YAML";
  if (normalized === "rollout-status") return "rollout status";
  if (normalized === "rollout-history") return "rollout history";
  return normalized.replace(/-/g, " ");
}

function buildTabSummary(target: { title: string; subtitle?: string | null }) {
  const title = target.title.trim() || "Untitled tab";
  const subtitle = target.subtitle?.trim();
  return subtitle ? `${title} - ${subtitle}` : title;
}

export function workbenchTabCloseNeedsConfirm(target: WorkbenchTabCloseTarget) {
  return target.hasUnsavedChanges === true || target.stopsPortForward === true;
}

export function hasUnsavedYaml(
  tab: { yamlText?: string | null; yamlOriginalText?: string | null } | null | undefined,
) {
  if (!tab) return false;
  return (tab.yamlText ?? "") !== (tab.yamlOriginalText ?? "");
}

/**
 * Refresh or Reload from cluster on a YAML tab replaces its text. With unsaved edits that
 * loses work, so the user is asked first; a clean tab reloads at once.
 */
export async function confirmDiscardYamlEdits(
  tab: { yamlText?: string | null; yamlOriginalText?: string | null } | null | undefined,
) {
  if (!hasUnsavedYaml(tab)) return true;
  return confirmAction(
    "Discard your edits and load the YAML from the cluster?\nUnsaved changes will be lost.",
    "Discard edits?",
  );
}

export async function confirmWorkbenchTabClose(target: WorkbenchTabCloseTarget) {
  if (!workbenchTabCloseNeedsConfirm(target)) return true;
  const kindLabel = normalizeKindLabel(target.kind);
  const loss = target.hasUnsavedChanges
    ? "Unsaved changes will be lost."
    : "The port-forward will stop.";
  return confirmAction(
    `Close this ${kindLabel} tab?\n${buildTabSummary(target)}\n${loss}`,
    "Close tab",
  );
}

export function announceWorkbenchTabClosed(
  target: { title: string; subtitle?: string | null },
  onUndo?: () => void,
) {
  toast(`Tab closed: ${buildTabSummary(target)}`, {
    duration: WORKBENCH_UNDO_TOAST_MS,
    action: onUndo ? { label: "Undo", onClick: onUndo } : undefined,
  });
}

type ClosedTabKey = {
  kind?: string;
  id?: string;
  target?: { name?: string; namespace?: string } | null;
};

/** Same closed tab: same kind (or id) and the same object. */
export function isSameClosedTab(a: ClosedTabKey, b: ClosedTabKey): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    a.target?.name === b.target?.name &&
    a.target?.namespace === b.target?.namespace
  );
}

/**
 * The Undo of the "Tab closed" toast: reopens exactly the tab it names, not whatever closed
 * last. None when Undo could not give back what the close took: unsaved YAML edits are gone,
 * and a stopped port-forward does not come back by reopening a tab.
 */
export function undoForClosedTab<T>(
  closed: { kind: string; hasUnsavedChanges?: boolean },
  entry: T | null | undefined,
  reopen: (entry: T) => unknown,
): (() => void) | undefined {
  if (!entry || closed.hasUnsavedChanges || closed.kind === "port-forward") return undefined;
  return () => {
    void reopen(entry);
  };
}
