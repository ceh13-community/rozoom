/** What Shell and Attach do, shown before the click (menu tooltips) and in the session window. */
export const SHELL_HINT =
  "Run commands inside the main container. Each command starts a new process (kubectl exec).";

export const ATTACH_HINT =
  "See what the process already running in the main container prints (kubectl attach). Read-only: it does not open a shell or send input.";

function containerLabel(container: string | undefined) {
  return container ? `container ${container}` : "the main container";
}

/** One line under the title of a pod session window. */
export function podSessionLine(mode: "pod-exec" | "pod-attach", container: string | undefined) {
  return mode === "pod-attach"
    ? `Showing what the running process of ${containerLabel(container)} prints. Read-only: input is not sent. This is not a shell.`
    : `Each command runs as a new process in ${containerLabel(container)}. Full-screen programs such as vi or top do not work here.`;
}
