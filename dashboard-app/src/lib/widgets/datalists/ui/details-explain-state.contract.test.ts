import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const resourceDetailsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/resource-details-sheet.svelte"),
  "utf8",
);
const podDetailsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pod-details-sheet.svelte"),
  "utf8",
);
const deploymentsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/deployments-list.svelte"),
  "utf8",
);
const jobsSource = readFileSync(resolve("src/lib/widgets/datalists/ui/jobs-list.svelte"), "utf8");
const cronJobsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/cron-jobs-list.svelte"),
  "utf8",
);
const statefulSetsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/stateful-sets-list.svelte"),
  "utf8",
);
const replicaSetsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/replica-sets-list.svelte"),
  "utf8",
);

describe("details explain state contract", () => {
  it("keeps the shared explain-state surface on pod, deployment, and generic resource details", () => {
    expect(resourceDetailsSource).toContain(
      'import DetailsExplainState from "./common/details-explain-state.svelte";',
    );
    expect(resourceDetailsSource).toContain("<DetailsExplainState");
    expect(resourceDetailsSource).toContain("<DetailsEventsList");

    expect(podDetailsSource).toContain(
      'import DetailsExplainState from "../common/details-explain-state.svelte";',
    );
    expect(podDetailsSource).toContain("<DetailsExplainState");
    expect(podDetailsSource).toContain("<DetailsEventsList");

    expect(deploymentsSource).toContain(
      'import DetailsExplainState from "./common/details-explain-state.svelte";',
    );
    expect(deploymentsSource).toContain("<DetailsExplainState");
    expect(deploymentsSource).toContain("<DetailsEventsList");
  });

  it("passes runtime explainability props into shared resource details sheets", () => {
    expect(jobsSource).toContain("runtimeProfileLabel={jobsRuntimeProfileLabel}");
    expect(jobsSource).toContain("runtimeSourceState={jobsRuntimeSourceState}");
    expect(jobsSource).toContain("events={detailsEvents}");
    expect(jobsSource).toContain("eventsLoading={detailsLoading}");
    expect(jobsSource).toContain("eventsError={detailsError}");
    expect(cronJobsSource).toContain("runtimeProfileLabel={cronJobsRuntimeProfileLabel}");
    expect(cronJobsSource).toContain("runtimeSourceState={cronJobsRuntimeSourceState}");
    expect(cronJobsSource).toContain("events={detailsEvents}");
    expect(cronJobsSource).toContain("eventsLoading={detailsLoading}");
    expect(cronJobsSource).toContain("eventsError={detailsError}");
    expect(statefulSetsSource).toContain("runtimeProfileLabel={statefulSetsRuntimeProfileLabel}");
    expect(statefulSetsSource).toContain("runtimeSourceState={statefulSetsRuntimeSourceState}");
    expect(statefulSetsSource).toContain("events={detailsEvents}");
    expect(statefulSetsSource).toContain("eventsLoading={detailsLoading}");
    expect(statefulSetsSource).toContain("eventsError={detailsError}");
    expect(replicaSetsSource).toContain("runtimeProfileLabel={replicaSetsRuntimeProfileLabel}");
    expect(replicaSetsSource).toContain("runtimeSourceState={replicaSetsRuntimeSourceState}");
    expect(replicaSetsSource).toContain("events={detailsEvents}");
    expect(replicaSetsSource).toContain("eventsLoading={detailsLoading}");
    expect(replicaSetsSource).toContain("eventsError={detailsError}");
  });
});
