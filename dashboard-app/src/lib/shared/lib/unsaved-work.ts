/**
 * Work the open page would lose when the user leaves it: YAML tabs with unsaved edits.
 * Lists keep their tabs in component state, so going to another page or another
 * workload drops them. Each list registers what it holds; the dashboard layout asks
 * before such a navigation.
 */

import { confirmAction } from "./confirm-action";

/** Returns a label per unsaved item (for example "YAML web"), empty when nothing is unsaved. */
export type UnsavedWorkProvider = () => string[];

const providers = new Set<UnsavedWorkProvider>();

/** Registers a provider; returns the cleanup. Fits `$effect(() => registerUnsavedWork(...))`. */
export function registerUnsavedWork(provider: UnsavedWorkProvider): () => void {
  providers.add(provider);
  return () => {
    providers.delete(provider);
  };
}

export function listUnsavedWork(): string[] {
  return [...providers].flatMap((provider) => {
    try {
      return provider();
    } catch {
      return [];
    }
  });
}

/**
 * Whether a navigation replaces the open list: another page, or another workload on the
 * same page. Filter, namespace and other query changes keep the list and its tabs.
 */
export function navigationLeavesList(from: URL | null | undefined, to: URL | null | undefined) {
  if (!from || !to) return false;
  return (
    from.pathname !== to.pathname ||
    from.searchParams.get("workload") !== to.searchParams.get("workload")
  );
}

export function describeUnsavedWork(items: string[]) {
  const shown = items.slice(0, 5);
  const more = items.length - shown.length;
  return `Leave this page?\n\n${shown.join("\n")}${more > 0 ? `\nand ${more} more` : ""}\n\nUnsaved changes will be lost.`;
}

// Set when the user already agreed to leave: the layout lets the next navigation through
// without asking again.
let leaveApproved = false;

export function approveNextLeave() {
  leaveApproved = true;
}

/** True once after `approveNextLeave`: the navigation the user agreed to. */
export function consumeLeaveApproval() {
  const approved = leaveApproved;
  leaveApproved = false;
  return approved;
}

/**
 * For an action that changes state and then leaves the page (a jump that sets the
 * namespace first): asks before anything changes. True to go on; the navigation that
 * follows is not asked again.
 */
export async function confirmLeaveWithUnsavedWork(): Promise<boolean> {
  const unsaved = listUnsavedWork();
  if (unsaved.length === 0) return true;
  const confirmed = await confirmAction(describeUnsavedWork(unsaved), "Unsaved changes");
  if (confirmed) approveNextLeave();
  return confirmed;
}

/** Forgets all providers and any approval (tests). */
export function resetUnsavedWorkForTests() {
  providers.clear();
  leaveApproved = false;
}
