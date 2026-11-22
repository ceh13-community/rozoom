import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A row actions menu is one button. The trigger used to render its own <button> around
// the Button: two Tab stops and a button inside a button (WCAG 4.1.2). The trigger now
// passes its props to the Button through the child snippet.
const MENUS = [
  "common/resource-actions-menu.svelte",
  "configuration-list/configuration-actions-menu.svelte",
  "cron-jobs-list/cronjob-actions-menu.svelte",
  "daemon-sets-list/daemonset-actions-menu.svelte",
  "deployments-list/deployment-actions-menu.svelte",
  "jobs-list/job-actions-menu.svelte",
  "nodes-list/node-actions-menu.svelte",
  "pods-list/pod-actions-menu.svelte",
  "replica-sets-list/replicaset-actions-menu.svelte",
  "stateful-sets-list/statefulset-actions-menu.svelte",
];

describe("row actions trigger", () => {
  it.each(MENUS)("%s renders one button for the trigger", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    const start = source.indexOf("<DropdownMenu.Trigger");
    const trigger = source.slice(start, source.indexOf("</DropdownMenu.Trigger>", start));
    expect(trigger).toContain("{#snippet child({ props })}");
    expect(trigger).toContain("{...props}");
    expect(trigger.match(/<Button\b/g)).toHaveLength(1);
  });
});
