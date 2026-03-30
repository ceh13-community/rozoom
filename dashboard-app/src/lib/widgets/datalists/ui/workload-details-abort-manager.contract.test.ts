import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workloadDetailsFiles = [
  "src/lib/widgets/datalists/ui/deployments-list.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
  "src/lib/widgets/datalists/ui/jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
  "src/lib/widgets/datalists/ui/configuration-list.svelte",
] as const;

const tabDetailsFiles = [
  "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
  "src/lib/widgets/datalists/ui/jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
] as const;

describe("workload details abort-manager contract", () => {
  it("uses shared details-action-manager and aborts on teardown", () => {
    for (const file of workloadDetailsFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain('from "./common/details-action-manager"');
      expect(source).toContain("createDetailsActionManager()");
      expect(source).toContain("detailsActions.abortAll()");
    }
  });

  it("uses latest-only guards for logs/yaml tab loaders in non-pods workload tabs", () => {
    for (const file of tabDetailsFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain("detailsActions.runLatest(`logs:${tabId}`");
      expect(source).toContain("detailsActions.runLatest(`yaml:${tabId}`");
    }
  });
});
