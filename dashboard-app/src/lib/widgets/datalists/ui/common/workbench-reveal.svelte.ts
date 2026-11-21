/**
 * Reveal for a list's workbench, as in the Pods list: after a row action opens or
 * re-opens a tab (Logs, Edit YAML, Events, Rollout, Investigate, port-forward), the
 * workbench scrolls into view and takes focus, also when that tab was already active.
 * MultiPaneWorkbench does the scroll and focus on each new `revealToken`.
 *
 * Only row actions go through `after`: restoring a saved session, Undo and a pane's own
 * Refresh open tabs too, and must not pull the page or the focus.
 */
export function createWorkbenchReveal() {
  let token = $state<number | null>(null);
  return {
    get token() {
      return token;
    },
    /** Reveals the workbench once `opened` settles (the tab exists by then). */
    after<T>(opened: Promise<T> | T): Promise<T> {
      return Promise.resolve(opened).finally(() => {
        token = (token ?? 0) + 1;
      });
    },
  };
}
