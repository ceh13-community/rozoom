import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const deploymentsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/deployments-list.svelte"),
  "utf8",
);
const daemonSetsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/daemon-sets-list.svelte"),
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
const nodesSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/nodes-list/nodes-statuses-list.svelte"),
  "utf8",
);
const replicationControllersSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);

describe("resource summary ui contract", () => {
  it("uses the shared summary strip on the core workload pages", () => {
    expect(podsSource).toContain(
      'import ResourceSummaryStrip from "../common/resource-summary-strip.svelte";',
    );
    expect(podsSource).toContain("<ResourceSummaryStrip");
    expect(podsSource).toContain('label: "Cluster"');
    expect(podsSource).toContain('label: "Namespace"');
    expect(podsSource).toContain('label: "Pods"');
    expect(podsSource).toContain('label: "Sync"');
    expect(podsSource).toContain('label: "View"');

    expect(deploymentsSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(deploymentsSource).toContain("<ResourceSummaryStrip");
    expect(deploymentsSource).toContain('label: "Deployments"');
    expect(deploymentsSource).toContain('label: "View"');

    expect(daemonSetsSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(daemonSetsSource).toContain("<ResourceSummaryStrip");
    expect(daemonSetsSource).toContain('label: "Daemon Sets"');
    expect(daemonSetsSource).toContain('label: "View"');

    expect(jobsSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(jobsSource).toContain("<ResourceSummaryStrip");
    expect(jobsSource).toContain('label: "Jobs"');
    expect(jobsSource).toContain('label: "View"');

    expect(cronJobsSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(cronJobsSource).toContain("<ResourceSummaryStrip");
    expect(cronJobsSource).toContain('label: "Cron Jobs"');
    expect(cronJobsSource).toContain('label: "View"');

    expect(statefulSetsSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(statefulSetsSource).toContain("<ResourceSummaryStrip");
    expect(statefulSetsSource).toContain('label: "Stateful Sets"');
    expect(statefulSetsSource).toContain('label: "View"');

    expect(replicaSetsSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(replicaSetsSource).toContain("<ResourceSummaryStrip");
    expect(replicaSetsSource).toContain('label: "Replica Sets"');
    expect(replicaSetsSource).toContain('label: "View"');

    expect(nodesSource).toContain(
      'import ResourceSummaryStrip from "../common/resource-summary-strip.svelte";',
    );
    expect(nodesSource).toContain("<ResourceSummaryStrip");
    expect(nodesSource).toContain('label: "Nodes"');

    expect(replicationControllersSource).toContain(
      'import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";',
    );
    expect(replicationControllersSource).toContain("<ResourceSummaryStrip");
    expect(replicationControllersSource).toContain(
      "{ label: tableTitle, value: filteredRows.length }",
    );
    expect(replicationControllersSource).toContain('label: "Sync"');
    expect(replicationControllersSource).toContain('label: "View"');
  });
});
