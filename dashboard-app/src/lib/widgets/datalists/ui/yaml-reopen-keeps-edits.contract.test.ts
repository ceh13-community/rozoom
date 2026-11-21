import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Edit YAML on a resource whose YAML tab is already open used to load the YAML again and
// put it over the text in the tab: unsaved edits were gone without a question. Every
// open path now checks the tab first and only shows it again when it has edits.
const OPEN_PATHS: Array<[file: string, opener: string, load: string]> = [
  [
    "deployments-list.svelte",
    "async function openYamlForDeployment(",
    "await kubectlRawArgsFront(",
  ],
  ["daemon-sets-list.svelte", "async function openYamlForDaemonSet(", "await refreshYamlForTab("],
  [
    "stateful-sets-list.svelte",
    "async function openYamlForStatefulSet(",
    "await refreshYamlForTab(",
  ],
  ["replica-sets-list.svelte", "async function openYamlForReplicaSet(", "await refreshYamlForTab("],
  ["jobs-list.svelte", "async function openYamlForJob(", "await refreshYamlForTab("],
  ["cron-jobs-list.svelte", "async function openYamlForCronJob(", "await refreshYamlForTab("],
  [
    "nodes-list/nodes-statuses-list.svelte",
    "async function openNodeYamlEditor(",
    "await refreshYamlForTab(",
  ],
  ["configuration-list.svelte", "async function openYamlTarget(", "await loadYamlForTab("],
  ["pods-list/pod-workbench-panel.svelte", "async function openYamlForPod(", "await readPodYaml("],
];

describe("opening Edit YAML again keeps unsaved edits", () => {
  it.each(OPEN_PATHS)("%s checks for edits before loading the YAML", (file, opener, load) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    const start = source.indexOf(opener);
    expect(start, `${opener} in ${file}`).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n  }\n", start));
    const check = body.indexOf("const keepEdits = hasUnsavedYaml(");
    const stop = body.indexOf("if (keepEdits) return;");
    const loadAt = body.indexOf(load);
    expect(check, "keepEdits check").toBeGreaterThan(-1);
    expect(stop, "return before the load").toBeGreaterThan(check);
    expect(loadAt, "the load").toBeGreaterThan(stop);
  });
});
