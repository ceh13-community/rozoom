import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const overviewSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/overview.svelte"),
  "utf8",
);
const configurationSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);
const networkSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/network/network-list.svelte"),
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
const daemonSetsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/daemon-sets-list.svelte"),
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

describe("runtime status ui contract", () => {
  it("keeps the shared runtime status surface on priority workload pages", () => {
    expect(podsSource).toContain(
      'import SectionRuntimeStatus from "../common/section-runtime-status.svelte";',
    );
    expect(podsSource).toContain('sectionLabel="Pods Runtime Status"');

    expect(overviewSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(overviewSource).toContain('sectionLabel="Overview Runtime Status"');

    expect(configurationSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(configurationSource).toContain(
      "const configurationRuntimeSectionLabel = $derived(`${tableTitle} Runtime Status`)",
    );
    expect(configurationSource).toContain("sectionLabel={configurationRuntimeSectionLabel}");
    expect(networkSource).toContain(
      'import SectionRuntimeStatus from "../common/section-runtime-status.svelte";',
    );
    expect(networkSource).toContain('sectionLabel="Network Runtime Status"');

    expect(deploymentsSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(deploymentsSource).toContain('sectionLabel="Deployments Runtime Status"');
    expect(jobsSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(jobsSource).toContain('sectionLabel="Jobs Runtime Status"');
    expect(cronJobsSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(cronJobsSource).toContain('sectionLabel="Cron Jobs Runtime Status"');
    expect(statefulSetsSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(statefulSetsSource).toContain('sectionLabel="Stateful Sets Runtime Status"');
    expect(daemonSetsSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(daemonSetsSource).toContain('sectionLabel="Daemon Sets Runtime Status"');
    expect(replicaSetsSource).toContain(
      'import SectionRuntimeStatus from "./common/section-runtime-status.svelte";',
    );
    expect(replicaSetsSource).toContain('sectionLabel="Replica Sets Runtime Status"');
    expect(nodesSource).toContain(
      'import SectionRuntimeStatus from "../common/section-runtime-status.svelte";',
    );
    expect(nodesSource).toContain('sectionLabel="Nodes Runtime Status"');

    // Storage and access-control workloads use configuration-list.svelte with dynamic labels
    expect(configurationSource).toContain('replicationcontrollers: "Replication Controllers"');
  });
});
