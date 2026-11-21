<script lang="ts">
  // Edit YAML for kinds a list has no workbench of its own for (custom resource
  // definitions, custom resources): the same tab editor as the workload lists, with
  // Apply, drift check, pin, panes, full screen, close confirm and Undo. It replaces the
  // read-only side panel these pages had.
  import { writable } from "svelte/store";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import ResourceYamlSheet from "./resource-yaml-sheet.svelte";
  import {
    announceWorkbenchTabClosed,
    confirmWorkbenchTabClose,
    hasUnsavedYaml,
  } from "./workbench-confirm";
  import {
    applyResourceYaml,
    loadResourceYaml,
    resourceYamlRef,
    type ResourceYamlTarget,
  } from "./apply-resource-yaml";

  export type ResourceYamlTabsRequest = {
    /** Changes on every row action, also for a tab that is already open. */
    token: number;
    name: string;
    namespace?: string;
    resource: string;
    namespaceScoped: boolean;
    /** Tab subtitle, e.g. "CRD" or the kind of a custom resource. */
    title?: string;
  } | null;

  type Layout = "single" | "dual" | "triple";
  type YamlTab = {
    id: string;
    title: string;
    subtitle: string;
    target: ResourceYamlTarget;
    originalYaml: string;
    yamlText: string;
    loading: boolean;
    saving: boolean;
    error: string | null;
    driftDetected: boolean;
    driftMessage: string | null;
    driftClusterYaml: string;
  };

  interface Props {
    clusterId: string;
    request: ResourceYamlTabsRequest;
    onMessage: (message: string) => void;
    onError: (message: string) => void;
  }

  const { clusterId, request, onMessage, onError }: Props = $props();

  const isOpen = writable(true);
  let tabs = $state<YamlTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let pinned = $state(new Set<string>());
  let closed = $state<Array<{ request: Exclude<ResourceYamlTabsRequest, null>; pinned: boolean }>>(
    [],
  );
  let layout = $state<Layout>("single");
  let fullscreen = $state(false);
  let collapsed = $state(false);
  let revealToken = $state<number | null>(null);
  let lastRequestToken = 0;

  const orderedTabs = $derived([
    ...tabs.filter((tab) => pinned.has(tab.id)),
    ...tabs.filter((tab) => !pinned.has(tab.id)),
  ]);
  const paneCount = $derived(layout === "triple" ? 3 : layout === "dual" ? 2 : 1);
  // The active tab first, then the next open tabs, one per pane.
  const paneTabIds = $derived.by(() => {
    const ids = orderedTabs.map((tab) => tab.id);
    const first = activeTabId && ids.includes(activeTabId) ? activeTabId : (ids[0] ?? null);
    const rest = ids.filter((id) => id !== first);
    return [first, ...rest].slice(0, paneCount);
  });

  function tabIdFor(target: ResourceYamlTarget) {
    return `yaml:${target.resource}:${target.namespace ?? ""}/${target.name}`;
  }

  function updateTab(id: string, patch: Partial<YamlTab>) {
    tabs = tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
  }

  function getTab(id: string | null) {
    return id ? (tabs.find((tab) => tab.id === id) ?? null) : null;
  }

  async function loadTab(id: string) {
    const tab = getTab(id);
    if (!tab || !clusterId) return;
    updateTab(id, { loading: true, error: null });
    try {
      const yaml = await loadResourceYaml(clusterId, tab.target);
      updateTab(id, {
        loading: false,
        originalYaml: yaml,
        yamlText: yaml,
        driftDetected: false,
        driftMessage: null,
        driftClusterYaml: "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load YAML.";
      updateTab(id, { loading: false, error: message });
      onError(message);
    }
  }

  async function openTab(next: Exclude<ResourceYamlTabsRequest, null>) {
    const target: ResourceYamlTarget = {
      resource: next.resource,
      name: next.name,
      namespace: next.namespace,
      namespaceScoped: next.namespaceScoped,
    };
    const id = tabIdFor(target);
    if (!getTab(id)) {
      tabs = [
        ...tabs,
        {
          id,
          title: next.name,
          subtitle: next.title ?? (target.namespaceScoped ? (target.namespace ?? "") : "cluster"),
          target,
          originalYaml: "",
          yamlText: "",
          loading: true,
          saving: false,
          error: null,
          driftDetected: false,
          driftMessage: null,
          driftClusterYaml: "",
        },
      ];
      activeTabId = id;
      collapsed = false;
      await loadTab(id);
    } else {
      activeTabId = id;
      collapsed = false;
    }
  }

  async function saveTab(id: string) {
    const tab = getTab(id);
    if (!tab || !clusterId) return;
    updateTab(id, { saving: true, error: null });
    const result = await applyResourceYaml({
      clusterId,
      target: tab.target,
      originalYaml: tab.originalYaml,
      yamlText: tab.yamlText,
    });
    if (result.status === "applied") {
      updateTab(id, {
        saving: false,
        originalYaml: tab.yamlText,
        driftDetected: false,
        driftMessage: null,
        driftClusterYaml: "",
      });
      onMessage(`Applied YAML: ${resourceYamlRef(tab.target)}`);
    } else if (result.status === "drift") {
      updateTab(id, {
        saving: false,
        driftDetected: true,
        driftMessage: result.message,
        driftClusterYaml: result.clusterYaml,
      });
    } else {
      updateTab(id, { saving: false, error: result.error });
    }
  }

  /** Keeps the edits, takes the cluster's current version as the new base. */
  function rebaseEdits(id: string) {
    const tab = getTab(id);
    if (!tab?.driftClusterYaml) return;
    updateTab(id, {
      originalYaml: tab.driftClusterYaml,
      driftDetected: false,
      driftMessage: null,
      driftClusterYaml: "",
    });
  }

  async function closeTab(id: string) {
    const tab = getTab(id);
    if (!tab) return;
    const confirmed = await confirmWorkbenchTabClose({
      kind: "yaml",
      title: tab.title,
      subtitle: tab.subtitle,
      hasUnsavedChanges: hasUnsavedYaml({
        yamlText: tab.yamlText,
        yamlOriginalText: tab.originalYaml,
      }),
    });
    if (!confirmed) return;
    const entry = {
      request: {
        token: 0,
        name: tab.target.name,
        namespace: tab.target.namespace,
        resource: tab.target.resource,
        namespaceScoped: tab.target.namespaceScoped,
        title: tab.subtitle,
      },
      pinned: pinned.has(id),
    };
    closed = [entry, ...closed].slice(0, 20);
    tabs = tabs.filter((item) => item.id !== id);
    pinned = new Set([...pinned].filter((pinnedId) => pinnedId !== id));
    if (activeTabId === id) activeTabId = orderedTabs.find((item) => item.id !== id)?.id ?? null;
    announceWorkbenchTabClosed(tab, () => void reopen(entry));
  }

  async function reopen(entry: (typeof closed)[number] | undefined) {
    if (!entry) return;
    closed = closed.filter((item) => item !== entry);
    await openTab(entry.request);
    if (entry.pinned) {
      pinned = new Set([...pinned, tabIdFor({ ...entry.request })]);
    }
  }

  function togglePin(id: string) {
    const next = new Set(pinned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    pinned = next;
  }

  // A row action: open or re-open the tab, then reveal the workbench and focus it.
  $effect(() => {
    const next = request;
    if (!next || next.token === lastRequestToken) return;
    lastRequestToken = next.token;
    void openTab(next).then(() => {
      revealToken = (revealToken ?? 0) + 1;
    });
  });
</script>

{#if tabs.length > 0}
  <MultiPaneWorkbench
    tabs={orderedTabs}
    {activeTabId}
    {paneTabIds}
    {revealToken}
    isTabPinned={(id) => pinned.has(id)}
    onActivateTab={(id) => {
      activeTabId = id;
    }}
    onTogglePin={togglePin}
    onCloseTab={(id) => void closeTab(id)}
    onReopenLastClosedTab={() => void reopen(closed[0])}
    reopenDisabled={closed.length === 0}
    {layout}
    onLayoutChange={(next) => {
      layout = next;
    }}
    {fullscreen}
    onToggleFullscreen={() => {
      fullscreen = !fullscreen;
      if (fullscreen) collapsed = false;
    }}
    {collapsed}
    onToggleCollapse={() => {
      collapsed = !collapsed;
    }}
  >
    {#snippet body()}
      {#if !collapsed}
        <div
          class={`grid gap-2 ${fullscreen ? "min-h-0 flex-1" : "h-[min(70dvh,760px)] min-h-[430px]"}`}
          style={`grid-template-columns: repeat(${paneTabIds.length}, minmax(0, 1fr));`}
          data-testid="resource-yaml-tabs"
        >
          {#each paneTabIds as paneTabId (paneTabId)}
            {@const tab = getTab(paneTabId)}
            {#if tab}
              <div class="min-h-0 min-w-0 overflow-hidden rounded border">
                <ResourceYamlSheet
                  embedded={true}
                  {isOpen}
                  podRef={resourceYamlRef(tab.target)}
                  originalYaml={tab.originalYaml}
                  yamlText={tab.yamlText}
                  loading={tab.loading}
                  saving={tab.saving}
                  hasChanges={tab.yamlText !== tab.originalYaml}
                  error={tab.error}
                  driftDetected={tab.driftDetected}
                  driftMessage={tab.driftMessage}
                  onYamlChange={(value) => updateTab(tab.id, { yamlText: value })}
                  onRefresh={() => void loadTab(tab.id)}
                  onSave={() => void saveTab(tab.id)}
                  onReloadFromCluster={() => void loadTab(tab.id)}
                  onRebaseEdits={() => rebaseEdits(tab.id)}
                />
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/snippet}
  </MultiPaneWorkbench>
{/if}
