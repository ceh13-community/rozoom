import { confirmAction } from "$shared/lib/confirm-action";

type WorkbenchTabConfirmTarget = {
  kind: string;
  title: string;
  subtitle?: string | null;
};

function normalizeKindLabel(kind: string) {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "yaml") return "YAML";
  if (normalized === "logs") return "logs";
  if (normalized === "events") return "events";
  if (normalized === "port-forward") return "port-forward";
  if (normalized === "rollout-status") return "rollout status";
  if (normalized === "rollout-history") return "rollout history";
  return normalized.replace(/-/g, " ");
}

function buildTabSummary(target: WorkbenchTabConfirmTarget) {
  const title = target.title.trim() || "Untitled tab";
  const subtitle = target.subtitle?.trim();
  return subtitle ? `${title} · ${subtitle}` : title;
}

export async function confirmWorkbenchTabClose(target: WorkbenchTabConfirmTarget) {
  const kindLabel = normalizeKindLabel(target.kind);
  const summary = buildTabSummary(target);
  const details =
    kindLabel === "YAML"
      ? "Unsaved YAML changes in this tab will be lost."
      : "This tab will be removed from the workbench.";
  return confirmAction(`Close this ${kindLabel} tab?\n${summary}\n${details}`, "Close tab");
}

export async function confirmWorkbenchLayoutShrink(details?: string) {
  return confirmAction(
    details ?? "Switch to fewer panes?\nTabs in hidden panes will be closed.",
    "Change pane layout",
  );
}
