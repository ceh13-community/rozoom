import { untrack } from "svelte";

/**
 * Switching to Realtime opens the workbench and its panes once. The effect this
 * replaces ran on every change while Realtime was on, so each Collapse click (the
 * workbench or a pane) was undone at once and the button looked broken.
 */
export function expandWorkbenchOnRealtimeSwitch(
  getProfileId: () => string | null | undefined,
  expand: () => void,
) {
  let lastProfileId: string | null | undefined;
  $effect(() => {
    const profileId = getProfileId();
    if (profileId === lastProfileId) return;
    lastProfileId = profileId;
    if (profileId === "realtime") untrack(expand);
  });
}
