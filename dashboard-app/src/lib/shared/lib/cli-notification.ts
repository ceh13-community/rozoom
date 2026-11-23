import { toast } from "svelte-sonner";

type CliNotification = {
  tool: string;
  args: string[];
  success: boolean;
  durationMs?: number;
};

const listeners = new Set<(n: CliNotification) => void>();
let suppressed = true;

export function emitCliNotification(n: CliNotification) {
  if (suppressed) return;
  for (const listener of listeners) listener(n);
}

export function suppressCliNotifications(value: boolean) {
  suppressed = value;
}

const MUTATING_SUBCOMMANDS = new Set([
  "apply",
  "delete",
  "scale",
  "rollout",
  "patch",
  "cordon",
  "uncordon",
  "drain",
  "taint",
  "label",
  "annotate",
  "edit",
  "create",
  "replace",
  "set",
  "autoscale",
  "expose",
  "run",
  "install",
  "upgrade",
  "uninstall",
  "rollback",
  // helm test runs the chart's test pods; kubectl has no such subcommand.
  "test",
]);

export function isUserFacingCommand(args: string[]): boolean {
  const sub = args.find((a) => !a.startsWith("-") && !a.startsWith("/"));
  if (!sub) return false;
  return MUTATING_SUBCOMMANDS.has(sub);
}

function sanitizeForDisplay(tool: string, args: string[]): string {
  return `${tool} ${args
    .filter((a) => !a.startsWith("--kubeconfig") && !a.startsWith("--request-timeout"))
    .map((a) => (a.includes(" ") ? `"${a}"` : a))
    .join(" ")}`;
}

/** "Command executed in 1.2 s": the title carries the completion time when it is known. */
export function cliNotificationTitle(n: Pick<CliNotification, "success" | "durationMs">): string {
  const base = n.success ? "Command executed" : "Command failed";
  if (n.durationMs === undefined || n.durationMs < 0) return base;
  return `${base} in ${(n.durationMs / 1000).toFixed(1)} s`;
}

export function initCliNotifications() {
  const handler = (n: CliNotification) => {
    const displayCmd = sanitizeForDisplay(n.tool, n.args);
    const fullCmd = `${n.tool} ${n.args.join(" ")}`;
    const toastFn = n.success ? toast.success : toast.error;
    toastFn(cliNotificationTitle(n), {
      description: displayCmd,
      descriptionClass:
        "font-mono !text-xs !leading-relaxed !break-all !whitespace-pre-wrap !max-h-24 !overflow-y-auto",
      duration: 10_000,
      action: {
        label: "Copy",
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-condition -- fire-and-forget clipboard write; clipboard may be undefined in some environments
        onClick: () => navigator.clipboard?.writeText(fullCmd),
      },
    });
  };
  listeners.add(handler);
  return () => listeners.delete(handler);
}
