import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsPath = resolve("src/lib/widgets/datalists/ui/pods-list/pod-workbench-panel.svelte");
const podsPanePath = resolve("src/lib/widgets/datalists/ui/pods-list/pod-workbench-pane.svelte");
const deploymentsPath = resolve("src/lib/widgets/datalists/ui/deployments-list.svelte");
const daemonSetsPath = resolve("src/lib/widgets/datalists/ui/daemon-sets-list.svelte");
const statefulSetsPath = resolve("src/lib/widgets/datalists/ui/stateful-sets-list.svelte");
const replicaSetsPath = resolve("src/lib/widgets/datalists/ui/replica-sets-list.svelte");
const jobsPath = resolve("src/lib/widgets/datalists/ui/jobs-list.svelte");
const cronJobsPath = resolve("src/lib/widgets/datalists/ui/cron-jobs-list.svelte");
const configurationListPath = resolve("src/lib/widgets/datalists/ui/configuration-list.svelte");
const multiPaneWorkbenchPath = resolve("src/lib/shared/ui/multi-pane-workbench.svelte");

const podsSource = readFileSync(podsPath, "utf8");
const podsPaneSource = readFileSync(podsPanePath, "utf8");
const deploymentsSource = readFileSync(deploymentsPath, "utf8");
const daemonSetsSource = readFileSync(daemonSetsPath, "utf8");
const statefulSetsSource = readFileSync(statefulSetsPath, "utf8");
const replicaSetsSource = readFileSync(replicaSetsPath, "utf8");
const jobsSource = readFileSync(jobsPath, "utf8");
const cronJobsSource = readFileSync(cronJobsPath, "utf8");
const configurationListSource = readFileSync(configurationListPath, "utf8");
const sharedWorkbenchSource = readFileSync(multiPaneWorkbenchPath, "utf8");

const closeNotificationButtonClass =
  "absolute right-2 top-2 rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30";
const successAlertClass =
  "mb-4 border-emerald-400/40 bg-emerald-100/20 text-emerald-900 dark:text-emerald-200";
const workbenchCloseTabClass =
  "rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30";
const paneSelectClass =
  "h-8 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const paneLabels = [
  '<option value="single">1 pane</option>',
  '<option value="dual">2 panes</option>',
  '<option value="triple">3 panes</option>',
];

describe("workbench UI parity contract", () => {
  it("keeps notification close button visuals aligned", () => {
    for (const source of [
      deploymentsSource,
      daemonSetsSource,
      statefulSetsSource,
      replicaSetsSource,
      jobsSource,
      cronJobsSource,
    ]) {
      expect(source).toContain(closeNotificationButtonClass);
      expect(source).toContain(successAlertClass);
    }
  });

  it("keeps workbench controls and close-tab visuals aligned", () => {
    expect(sharedWorkbenchSource).toContain(workbenchCloseTabClass);
    for (const source of [
      deploymentsSource,
      daemonSetsSource,
      statefulSetsSource,
      replicaSetsSource,
      jobsSource,
      cronJobsSource,
      configurationListSource,
    ]) {
      expect(source).toContain("<MultiPaneWorkbench");
      expect(source).toContain(workbenchCloseTabClass);
    }

    for (const source of [
      sharedWorkbenchSource,
      podsSource,
      deploymentsSource,
      daemonSetsSource,
      statefulSetsSource,
      replicaSetsSource,
      jobsSource,
      cronJobsSource,
      configurationListSource,
    ]) {
      expect(source).toContain("Reopen");
      expect(source).toContain("Fullscreen");
      expect(source).toContain("Collapse");
    }
    expect(sharedWorkbenchSource).toContain("Incident timeline");
    expect(sharedWorkbenchSource).toContain("Warnings only");
    expect(sharedWorkbenchSource).toContain(paneSelectClass);
    for (const label of paneLabels) {
      expect(sharedWorkbenchSource).toContain(label);
    }
    expect(podsSource).toContain("Select tab for pane");
    expect(podsSource).toContain("Select for compare");
    expect(podsSource).toContain("Compare with selected");
    expect(podsPaneSource).toContain("isVerticallyCollapsed");
    expect(podsPaneSource).toContain("externalDiffLines");
  });
});
