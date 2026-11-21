import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// Row actions reveal the workbench and move focus to it in every list, as in Pods: the
// list passes a reveal token that changes after each row action that opens a tab.
describe("workbench reveal after row actions", () => {
  it.each([
    ["deployments-list.svelte", "openLogsForDeployment(deployment)"],
    ["daemon-sets-list.svelte", "openLogsForDaemonSet(daemonSet)"],
    ["stateful-sets-list.svelte", "openEventsForStatefulSet(statefulSet)"],
    ["replica-sets-list.svelte", "openLogsForReplicaSet(item as unknown as ReplicaSetItem)"],
    ["jobs-list.svelte", "openLogsForJob(item as unknown as JobItem)"],
    ["cron-jobs-list.svelte", "openLogsForCronJob(cronJob)"],
    ["configuration-list.svelte", "openYamlEditor(row)"],
    ["nodes-list/nodes-statuses-list.svelte", "openNodeYamlEditor(row)"],
  ])("%s reveals the workbench after %s", (file, call) => {
    const source = read(file);
    expect(source).toContain("const workbenchReveal = createWorkbenchReveal();");
    expect(source).toContain("revealToken={workbenchReveal.token}");
    expect(source).toContain(`workbenchReveal.after(${call})`);
  });

  it("does not reveal on session restore, Undo or a pane's own Refresh", () => {
    const deployments = read("deployments-list.svelte");
    expect(deployments).toContain("void openLogsForDeployment(entry.deployment);");
    expect(deployments).toContain(
      "void openRolloutCommandForDeployment(currentRolloutTab.mode, deployment);",
    );
    expect(deployments).toMatch(/function refreshYamlForTab[\s\S]*?void openYamlForDeployment\(/);
  });

  it.each([
    "../../../shared/ui/multi-pane-workbench.svelte",
    "cron-jobs-list.svelte",
    "jobs-list.svelte",
    "stateful-sets-list.svelte",
    "daemon-sets-list.svelte",
    "replica-sets-list.svelte",
  ])("%s keeps the workbench under the sticky page header", (file) => {
    const source = read(file);
    expect(source).toContain(
      '"relative z-20 has-[[data-fullscreen-panel]]:z-[100] mb-4 scroll-mt-32',
    );
    expect(source).not.toContain("relative z-[100]");
  });

  it("shows and focuses the CRD instances after Browse instances, not after its Refresh", () => {
    const source = read("custom-resources/custom-resources-list.svelte");
    expect(source).toContain("function browseInstances(row: CustomResourceRow)");
    expect(source).toContain("revealResult(section);");
    expect(source).toContain("bind:this={instancesSection}");
    expect(source.match(/void browseInstances\(row\)/g)).toHaveLength(3);
    expect(source).toContain("void loadInstances(activeInstancesDefinition);");
  });

  it("reveals the Helm release inspector after History, Status, Values and Manifest", () => {
    const helm = read("../../cluster/ui/helm-panel.svelte");
    expect(helm.match(/clearInspector\(\);\n    void revealInspector\(\);/g)).toHaveLength(4);
    expect(helm).toContain("bind:this={releaseInspectorEl}");
  });

  it("brings the Workload Map node details into view, focus stays on the node", () => {
    const map = read("../../../shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte");
    expect(map).toContain("revealResult(selectedDetailEl, { focus: false })");
    expect(map).toContain("onclick={() => void selectNode(node)}");
  });

  it("lands a Jump to page from Service Chains and Workload Map on the filtered list", () => {
    const chains = read("../../cluster/ui/resource-map-panel.svelte");
    const map = read("../../../shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte");
    expect(chains).toContain("await revealListFilteredTo(name);");
    expect(chains).toContain("void jumpToWorkload(node.kind, node.name, node.namespace)");
    expect(map).toContain("await revealListFilteredTo(node.name);");
  });

  it("brings the Helm console into view with focus, not while typing elsewhere", () => {
    const helm = read("../../cluster/ui/helm-panel.svelte");
    expect(helm).toMatch(
      /function scrollToConsole\(\) \{[\s\S]*?isTypingOutside\(document\.activeElement, consoleEl\)[\s\S]*?revealResult\(consoleEl\)/,
    );
  });

  it("reveals Edit YAML from the node details too", () => {
    const nodes = read("nodes-list/nodes-statuses-list.svelte");
    expect(nodes.match(/workbenchReveal\.after\(openNodeYamlEditor\(/g)).toHaveLength(3);
  });

  it("selects the resource's namespace before a jump from the maps", () => {
    const chains = read("../../cluster/ui/resource-map-panel.svelte");
    const map = read("../../../shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte");
    for (const source of [chains, map]) {
      const jump = source.slice(source.indexOf("async function jumpToWorkload("));
      const select = jump.indexOf("onSelectNamespace?.(");
      expect(select).toBeGreaterThan(0);
      expect(select).toBeLessThan(jump.indexOf("await goto("));
    }
    expect(chains).toContain("void jumpToWorkload(node.kind, node.name, node.namespace)");
    for (const wrapper of [
      "cluster-health/resource-map-panel.svelte",
      "cluster-health/workload-visualizer-panel.svelte",
    ]) {
      expect(read(wrapper)).toContain(
        "onSelectNamespace={(namespace) => setSelectedNamespace(data.slug, namespace)}",
      );
    }
  });
});
