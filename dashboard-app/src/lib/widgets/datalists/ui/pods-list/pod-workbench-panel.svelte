<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { writable } from "svelte/store";
  import { load as parseYaml, YAMLException } from "js-yaml";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import Target from "@lucide/svelte/icons/target";
  import { path } from "@tauri-apps/api";
  import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import ResourceMetricsBadge from "../common/resource-metrics-badge.svelte";
  import type { PodItem } from "$shared/model/clusters";
  import type { PodEvent } from "$features/pod-details";
  import { loadPodEvents } from "$features/pod-details";
  import {
    buildYamlFilename,
    computeLayoutClosePlan,
    formatApplyErrorMessage,
    orderPinnedTabs,
    recoverWorkbenchTabs,
  } from "$features/pods-workbench";
  import {
    kubectlRawArgsFront,
    kubectlStreamArgsFront,
    type KubectlStreamProcess,
  } from "$shared/api/kubectl-proxy";
  import PodWorkbenchPane from "./pod-workbench-pane.svelte";
  import { buildPodLogsArgs } from "./pod-actions";
  import type { PodMetricsValue } from "./model/pod-row-adapter";
  import { dashboardDataProfile } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    getLegacyPodsWorkbenchStateKey,
    getPodsWorkbenchStateKey,
    parsePodsWorkbenchState,
    type PodsWorkbenchLayout,
    type PersistedPodsWorkbenchState,
  } from "./workbench-session";
  import {
    confirmWorkbenchLayoutShrink,
    confirmWorkbenchTabClose,
  } from "../common/workbench-confirm";
  import { normalizeWorkbenchVisibilityForDataMode } from "../common/workbench-data-mode";

  export type WorkbenchOpenRequest = {
    token: number;
    kind: "logs" | "yaml" | "events" | "investigate";
    podUid: string;
    logsPrevious?: boolean;
  } | null;

  type WorkbenchTabKind = "logs" | "yaml" | "events";
  type WorkbenchTab = {
    id: string;
    kind: WorkbenchTabKind;
    title: string;
    subtitle: string;
    podUid: string;
  };
  type LogsTabState = {
    id: string;
    podRef: string;
    podUid: string;
    logsText: string;
    logsError: string | null;
    logsLoading: boolean;
    logsLive: boolean;
    logsMode: "poll" | "stream-f";
    logsUpdatedAt: number | null;
    logsPrevious: boolean;
    logsContainerOptions: string[];
    logsSelectedContainer: string;
    bookmarks: Array<{ id: string; line: number; label: string; createdAt: number }>;
  };
  type YamlTabState = {
    id: string;
    podRef: string;
    podUid: string;
    originalYamlText: string;
    yamlText: string;
    yamlError: string | null;
    yamlLoading: boolean;
    yamlSaving: boolean;
    driftDetected: boolean;
    driftMessage: string | null;
  };
  type EventsTabState = {
    id: string;
    podRef: string;
    podUid: string;
    events: PodEvent[];
    eventsLoading: boolean;
    eventsError: string | null;
    focusedEventIndex: number | null;
  };

  interface PodWorkbenchPanelProps {
    clusterId: string;
    podsByUid: Map<string, Partial<PodItem>>;
    metricsByKey: Map<string, PodMetricsValue>;
    metricsError: string | null;
    request: WorkbenchOpenRequest;
    onMessage?: (message: string) => void;
    onError?: (message: string) => void;
  }

  const {
    clusterId,
    podsByUid,
    metricsByKey,
    metricsError,
    request,
    onMessage = () => {},
    onError = () => {},
  }: PodWorkbenchPanelProps = $props();

  const logsOpen = writable(true);
  const yamlOpen = writable(true);
  const eventsOpen = writable(true);
  const logsStreamReconnectMs = 1_200;

  let workbenchCollapsed = $state(false);
  let workbenchFullscreen = $state(false);
  let workbenchLayout = $state<PodsWorkbenchLayout>("single");
  let workbenchTabs = $state<WorkbenchTab[]>([]);
  let activeWorkbenchTabId = $state<string | null>(null);
  let pinnedTabIds = $state(new Set<string>());
  let paneTabIds = $state<[string | null, string | null, string | null]>([null, null, null]);
  let collapsedPaneIndexes = $state<number[]>([]);
  let closedWorkbenchTabs = $state<PersistedPodsWorkbenchState["closedTabs"]>([]);
  let logsTabs = $state<LogsTabState[]>([]);
  let yamlTabs = $state<YamlTabState[]>([]);
  let eventsTabs = $state<EventsTabState[]>([]);
  let pendingWorkbenchState = $state<PersistedPodsWorkbenchState | null | undefined>(undefined);
  let lastRequestToken = $state<number | null>(null);
  let lastLoadedProfileId = $state<string | null>(null);
  let logsJumpToLine = $state<number | null>(null);
  let incidentTimelineDensity = $state<"all" | "warnings">("all");
  let incidentTimelineCursorId = $state<string | null>(null);
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);
  let logsLiveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let logsStreamProcesses = new Map<string, KubectlStreamProcess>();
  let logsStreamReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const orderedWorkbenchTabs = $derived.by(() => orderPinnedTabs(workbenchTabs, pinnedTabIds));
  const activeWorkbenchTab = $derived.by(
    () => orderedWorkbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );
  const activeLogsTab = $derived.by(
    () => logsTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );
  const activeYamlTab = $derived.by(
    () => yamlTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );
  const activeEventsTab = $derived.by(
    () => eventsTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );
  const hasWorkbenchTabs = $derived(orderedWorkbenchTabs.length > 0);
  const paneCount = $derived.by(() => {
    if (workbenchLayout === "single") return 1;
    if (workbenchLayout === "dual") return 2;
    return 3;
  });
  const availablePaneTabs = $derived.by(() =>
    orderedWorkbenchTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      subtitle: tab.subtitle,
    })),
  );
  const activeIncidentTimeline = $derived.by(() => {
    if (!activeEventsTab) return [];
    return activeEventsTab.events.map((event, index) => ({
      id: `${activeEventsTab.id}:${index}`,
      ts: event.lastTimestamp || new Date().toISOString(),
      label: event.type === "Warning" ? "Warning" : event.reason,
      detail: `${event.reason}: ${event.message}`,
      severity: event.type === "Warning" ? "warning" : "info",
    }));
  });
  const visibleIncidentTimeline = $derived.by(() =>
    incidentTimelineDensity === "warnings"
      ? activeIncidentTimeline.filter((marker) => marker.severity === "warning")
      : activeIncidentTimeline,
  );
  const canShowIncidentTimeline = $derived(activeIncidentTimeline.length > 0);

  function parseWorkbenchTabId(
    tabId: string,
  ): { kind: WorkbenchTabKind; namespace: string; name: string } | null {
    const match = /^(logs|yaml|events):([^/]+)\/(.+)$/.exec(tabId);
    if (!match) return null;
    return {
      kind: match[1] as WorkbenchTabKind,
      namespace: match[2],
      name: match[3],
    };
  }

  function getPodForUid(podUid: string) {
    return podsByUid.get(podUid) ?? null;
  }

  function getScopedWorkbenchStateKey(profileId = $dashboardDataProfile.id) {
    return getPodsWorkbenchStateKey(clusterId, profileId);
  }

  function readStoredWorkbenchState(profileId = $dashboardDataProfile.id) {
    if (typeof window === "undefined" || !clusterId) return null;
    const scoped = parsePodsWorkbenchState(
      window.localStorage.getItem(getScopedWorkbenchStateKey(profileId)),
    );
    if (scoped) return scoped;
    return parsePodsWorkbenchState(
      window.localStorage.getItem(getLegacyPodsWorkbenchStateKey(clusterId)),
    );
  }

  function getPaneIndexes() {
    return Array.from({ length: paneCount }, (_, idx) => idx as 0 | 1 | 2);
  }

  function arraysEqual(left: number[], right: number[]) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  function ensurePaneAssignments() {
    const availableTabIds = new Set(orderedWorkbenchTabs.map((tab) => tab.id));
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    for (const idx of [0, 1, 2] as const) {
      if (next[idx] && !availableTabIds.has(next[idx])) {
        next[idx] = null;
      }
      if (idx >= paneCount) {
        next[idx] = null;
      }
    }
    if (
      (!activeWorkbenchTabId || !availableTabIds.has(activeWorkbenchTabId)) &&
      orderedWorkbenchTabs.length > 0
    ) {
      activeWorkbenchTabId = orderedWorkbenchTabs[0]?.id ?? null;
    }
    if (!next[0] && activeWorkbenchTabId) {
      next[0] = activeWorkbenchTabId;
    }
    let candidateIndex = 0;
    for (const idx of [1, 2] as const) {
      if (idx >= paneCount || next[idx]) continue;
      while (
        candidateIndex < orderedWorkbenchTabs.length &&
        next.includes(orderedWorkbenchTabs[candidateIndex]?.id ?? null)
      ) {
        candidateIndex += 1;
      }
      next[idx] = orderedWorkbenchTabs[candidateIndex]?.id ?? null;
      candidateIndex += 1;
    }
    if (next[0] !== paneTabIds[0] || next[1] !== paneTabIds[1] || next[2] !== paneTabIds[2]) {
      paneTabIds = next;
    }
    const nextCollapsed = collapsedPaneIndexes.filter(
      (paneIndex) => paneIndex < paneCount && next[paneIndex] !== null,
    );
    if (!arraysEqual(nextCollapsed, collapsedPaneIndexes)) {
      collapsedPaneIndexes = nextCollapsed;
    }
  }

  function isTabPinned(tabId: string) {
    return pinnedTabIds.has(tabId);
  }

  function setActiveWorkbenchTab(tabId: string) {
    activeWorkbenchTabId = tabId;
    if (paneTabIds[0] !== tabId) {
      paneTabIds = [tabId, paneTabIds[1], paneTabIds[2]];
    }
  }

  async function requestWorkbenchLayout(nextLayout: PodsWorkbenchLayout) {
    if (nextLayout === workbenchLayout) return;
    const nextPaneCount = nextLayout === "single" ? 1 : nextLayout === "dual" ? 2 : 3;
    const { occupiedRemovedPaneCount } = computeLayoutClosePlan(paneTabIds, nextPaneCount);
    if (occupiedRemovedPaneCount > 0) {
      const confirmed = await confirmWorkbenchLayoutShrink();
      if (!confirmed) return;
    }
    workbenchLayout = nextLayout;
    if (nextLayout === "single") {
      paneTabIds = [activeWorkbenchTabId, null, null];
      collapsedPaneIndexes = [];
    } else if (nextLayout === "dual") {
      paneTabIds = [paneTabIds[0] ?? activeWorkbenchTabId, paneTabIds[1], null];
      collapsedPaneIndexes = collapsedPaneIndexes.filter((paneIndex) => paneIndex < 2);
    }
  }

  function reopenLastClosedTab() {
    const next = closedWorkbenchTabs[0];
    if (!next?.target) return;
    closedWorkbenchTabs = closedWorkbenchTabs.slice(1);
    const pod = Array.from(podsByUid.values()).find(
      (entry) =>
        entry.metadata?.name === next.target?.name &&
        entry.metadata?.namespace === next.target?.namespace,
    );
    if (!pod) return;
    if (next.kind === "logs") {
      void openLogsForPod(pod);
    } else if (next.kind === "yaml") {
      void openYamlForPod(pod);
    } else {
      void openEventsForPod(pod);
    }
  }

  function jumpToIncidentMarker(marker: { id: string; ts: string | number }) {
    incidentTimelineCursorId = marker.id;
    if (!activeEventsTab) return;
    activeWorkbenchTabId = activeEventsTab.id;
    const nextIndex = activeEventsTab.events.findIndex((event) => {
      const ts = event.lastTimestamp || null;
      return ts === marker.ts;
    });
    if (nextIndex >= 0) {
      eventsTabs = eventsTabs.map((tab) =>
        tab.id === activeEventsTab.id ? { ...tab, focusedEventIndex: nextIndex } : tab,
      );
    }
  }

  function getMetricsForPodUid(podUid: string) {
    const pod = getPodForUid(podUid);
    if (!pod) return null;
    return (
      metricsByKey.get(`${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? ""}`) ??
      null
    );
  }

  function getPaneTabId(paneIndex: number) {
    return paneTabIds[paneIndex] ?? null;
  }

  function getPaneTab(paneIndex: number) {
    const paneTabId = getPaneTabId(paneIndex);
    return orderedWorkbenchTabs.find((tab) => tab.id === paneTabId) ?? null;
  }

  function getPaneLogsTab(paneIndex: number) {
    const paneTabId = getPaneTabId(paneIndex);
    return logsTabs.find((tab) => tab.id === paneTabId) ?? null;
  }

  function getPaneYamlTab(paneIndex: number) {
    const paneTabId = getPaneTabId(paneIndex);
    return yamlTabs.find((tab) => tab.id === paneTabId) ?? null;
  }

  function getPaneEventsTab(paneIndex: number) {
    const paneTabId = getPaneTabId(paneIndex);
    return eventsTabs.find((tab) => tab.id === paneTabId) ?? null;
  }

  function getPaneRenderableTab(paneIndex: number) {
    const paneTab = getPaneTab(paneIndex);
    if (!paneTab) return null;
    if (paneTab.kind === "logs") {
      const logsTab = getPaneLogsTab(paneIndex);
      return logsTab ? { ...logsTab, kind: "logs" as const } : null;
    }
    if (paneTab.kind === "yaml") {
      const yamlTab = getPaneYamlTab(paneIndex);
      return yamlTab ? { ...yamlTab, kind: "yaml" as const } : null;
    }
    const eventsTab = getPaneEventsTab(paneIndex);
    return eventsTab ? { ...eventsTab, kind: "events" as const } : null;
  }

  function isPaneCollapsed(paneIndex: number) {
    return collapsedPaneIndexes.includes(paneIndex);
  }

  function canCollapsePane(paneIndex: number) {
    if (paneCount <= 1) return false;
    return getPaneTabId(paneIndex) !== null;
  }

  function togglePaneCollapsed(paneIndex: number) {
    if (!canCollapsePane(paneIndex)) return;
    if (collapsedPaneIndexes.includes(paneIndex)) {
      collapsedPaneIndexes = collapsedPaneIndexes.filter((index) => index !== paneIndex);
      return;
    }
    const expandedCount = paneCount - collapsedPaneIndexes.length;
    if (expandedCount <= 1) return;
    collapsedPaneIndexes = [...collapsedPaneIndexes, paneIndex];
  }

  function getPaneWrapperClass(paneIndex: number) {
    return isPaneCollapsed(paneIndex) ? "w-11 flex-none" : "min-h-0 min-w-0 flex-1";
  }

  function canCompareWithSelected(tabId: string) {
    return tabId.startsWith("yaml:");
  }

  function isYamlCompareTarget(tabId: string) {
    return yamlCompareTargetTabId === tabId;
  }

  function selectYamlForCompare(tabId: string) {
    if (!canCompareWithSelected(tabId)) return;
    if (yamlCompareSourceTabId === tabId) {
      yamlCompareSourceTabId = null;
      if (yamlComparePair && (yamlComparePair[0] === tabId || yamlComparePair[1] === tabId)) {
        yamlComparePair = null;
        yamlCompareTargetTabId = null;
      }
      return;
    }
    yamlCompareSourceTabId = tabId;
  }

  function compareYamlWithSelected(targetTabId: string) {
    if (!canCompareWithSelected(targetTabId)) return;
    if (!yamlCompareSourceTabId) {
      yamlCompareSourceTabId = targetTabId;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    if (yamlCompareSourceTabId === targetTabId) {
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    if (
      yamlComparePair &&
      ((yamlComparePair[0] === yamlCompareSourceTabId && yamlComparePair[1] === targetTabId) ||
        (yamlComparePair[1] === yamlCompareSourceTabId && yamlComparePair[0] === targetTabId))
    ) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }

    yamlComparePair = [yamlCompareSourceTabId, targetTabId];
    yamlCompareTargetTabId = targetTabId;
    workbenchLayout = "dual";
    paneTabIds = [yamlCompareSourceTabId, targetTabId, null];
    collapsedPaneIndexes = [];
    activeWorkbenchTabId = targetTabId;
  }

  function getYamlCompareDiffLines(tabId: string) {
    if (!yamlComparePair) return [];
    const [leftId, rightId] = yamlComparePair;
    const partnerId = leftId === tabId ? rightId : rightId === tabId ? leftId : null;
    if (!partnerId) return [];

    const tab = yamlTabs.find((entry) => entry.id === tabId);
    const partner = yamlTabs.find((entry) => entry.id === partnerId);
    if (!tab || !partner) return [];

    const leftLines = tab.yamlText.replace(/\r\n/g, "\n").split("\n");
    const rightLines = partner.yamlText.replace(/\r\n/g, "\n").split("\n");
    const maxLines = Math.max(leftLines.length, rightLines.length);
    const diffLines: number[] = [];
    for (let index = 0; index < maxLines; index += 1) {
      if ((leftLines[index] ?? "") !== (rightLines[index] ?? "")) {
        diffLines.push(index + 1);
      }
    }
    return diffLines;
  }

  function getTabId(kind: WorkbenchTabKind, pod: Partial<PodItem>) {
    const namespace = pod.metadata?.namespace ?? "default";
    const name = pod.metadata?.name ?? "unknown";
    return `${kind}:${namespace}/${name}`;
  }

  function upsertWorkbenchTab(tab: WorkbenchTab) {
    const parsed = parseWorkbenchTabId(tab.id);
    if (parsed) {
      closedWorkbenchTabs = closedWorkbenchTabs.filter(
        (entry) =>
          entry.kind !== parsed.kind ||
          entry.target?.name !== parsed.name ||
          entry.target?.namespace !== parsed.namespace,
      );
    }
    if (workbenchTabs.some((entry) => entry.id === tab.id)) {
      setActiveWorkbenchTab(tab.id);
      workbenchCollapsed = false;
      return;
    }
    workbenchTabs = [...workbenchTabs, tab];
    setActiveWorkbenchTab(tab.id);
    workbenchCollapsed = false;
  }

  function togglePinnedTab(tabId: string) {
    const next = new Set(pinnedTabIds);
    if (next.has(tabId)) {
      next.delete(tabId);
    } else {
      next.add(tabId);
    }
    pinnedTabIds = next;
  }

  function stopLogsRuntime(tabId: string) {
    const timer = logsLiveTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      logsLiveTimers.delete(tabId);
    }
    const reconnectTimer = logsStreamReconnectTimers.get(tabId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      logsStreamReconnectTimers.delete(tabId);
    }
    const process = logsStreamProcesses.get(tabId);
    if (process) {
      void process.stop().catch(() => undefined);
      logsStreamProcesses.delete(tabId);
    }
  }

  function scheduleStreamReconnect(tabId: string) {
    const previous = logsStreamReconnectTimers.get(tabId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      logsStreamReconnectTimers.delete(tabId);
      const tab = logsTabs.find((entry) => entry.id === tabId);
      if (!tab || !tab.logsLive || tab.logsMode !== "stream-f") return;
      updateLogsTab(tabId, {
        logsError: "Stream disconnected. Reconnecting...",
      });
      void startFollowStreamForTab(tabId);
    }, logsStreamReconnectMs);
    logsStreamReconnectTimers.set(tabId, timer);
  }

  function updateLogsTab(tabId: string, patch: Partial<LogsTabState>) {
    logsTabs = logsTabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
  }

  function updateYamlTab(tabId: string, patch: Partial<YamlTabState>) {
    yamlTabs = yamlTabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
  }

  function updateEventsTab(tabId: string, patch: Partial<EventsTabState>) {
    eventsTabs = eventsTabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
  }

  async function closeWorkbenchTab(tabId: string) {
    const closingTab = workbenchTabs.find((tab) => tab.id === tabId) ?? null;
    if (closingTab) {
      const confirmed = await confirmWorkbenchTabClose(closingTab);
      if (!confirmed) return;
    }
    const parsed = parseWorkbenchTabId(tabId);
    const wasPinned = pinnedTabIds.has(tabId);
    if (parsed) {
      closedWorkbenchTabs = [
        {
          kind: parsed.kind,
          target: { name: parsed.name, namespace: parsed.namespace },
          pinned: wasPinned,
        },
        ...closedWorkbenchTabs.filter(
          (entry) =>
            entry.kind !== parsed.kind ||
            entry.target?.name !== parsed.name ||
            entry.target?.namespace !== parsed.namespace,
        ),
      ].slice(0, 20);
    }
    workbenchTabs = workbenchTabs.filter((tab) => tab.id !== tabId);
    logsTabs = logsTabs.filter((tab) => tab.id !== tabId);
    yamlTabs = yamlTabs.filter((tab) => tab.id !== tabId);
    eventsTabs = eventsTabs.filter((tab) => tab.id !== tabId);
    pinnedTabIds = new Set([...pinnedTabIds].filter((id) => id !== tabId));
    paneTabIds = paneTabIds.map((paneTabId) => (paneTabId === tabId ? null : paneTabId)) as [
      string | null,
      string | null,
      string | null,
    ];
    collapsedPaneIndexes = collapsedPaneIndexes.filter(
      (paneIndex) => paneTabIds[paneIndex] !== null,
    );
    if (yamlCompareSourceTabId === tabId) yamlCompareSourceTabId = null;
    if (yamlComparePair && (yamlComparePair[0] === tabId || yamlComparePair[1] === tabId)) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
    stopLogsRuntime(tabId);

    if (activeWorkbenchTabId === tabId) {
      activeWorkbenchTabId = workbenchTabs.find((tab) => tab.id !== tabId)?.id ?? null;
    }
  }

  async function readPodYaml(pod: Partial<PodItem>) {
    const response = await kubectlRawArgsFront(
      [
        "get",
        "pod",
        pod.metadata?.name ?? "",
        "-n",
        pod.metadata?.namespace ?? "default",
        "-o",
        "yaml",
      ],
      { clusterId },
    );
    if (response.errors) {
      throw new Error(response.errors);
    }
    return response.output;
  }

  async function refreshLogsTab(tabId: string) {
    const parsed = parseWorkbenchTabId(tabId);
    const tab = logsTabs.find((entry) => entry.id === tabId);
    if (!parsed || !tab) return;
    const args = buildPodLogsArgs({
      name: parsed.name,
      namespace: parsed.namespace,
      container: tab.logsSelectedContainer || undefined,
      previous: tab.logsPrevious,
      follow: false,
    });
    if (!args) return;

    updateLogsTab(tabId, {
      logsLoading: true,
      logsError: null,
    });
    try {
      const response = await kubectlRawArgsFront(args, { clusterId });
      if (response.errors) {
        throw new Error(response.errors);
      }
      updateLogsTab(tabId, {
        logsText: response.output,
        logsLoading: false,
        logsUpdatedAt: Date.now(),
      });
    } catch (error) {
      updateLogsTab(tabId, {
        logsLoading: false,
        logsError: error instanceof Error ? error.message : "Failed to load logs.",
      });
      onError(error instanceof Error ? error.message : "Failed to load logs.");
    }
  }

  function scheduleLogsPolling(tabId: string) {
    const timer = setTimeout(async () => {
      logsLiveTimers.delete(tabId);
      const tab = logsTabs.find((entry) => entry.id === tabId);
      if (!tab?.logsLive || tab.logsMode !== "poll") return;
      await refreshLogsTab(tabId);
      scheduleLogsPolling(tabId);
    }, 2_000);
    logsLiveTimers.set(tabId, timer);
  }

  async function startFollowStreamForTab(tabId: string) {
    const tab = logsTabs.find((entry) => entry.id === tabId);
    const parsed = parseWorkbenchTabId(tabId);
    if (!tab || !parsed) return;
    stopLogsRuntime(tabId);

    updateLogsTab(tabId, {
      logsLoading: true,
      logsError: null,
    });

    const args = buildPodLogsArgs({
      name: parsed.name,
      namespace: parsed.namespace,
      container: tab.logsSelectedContainer || undefined,
      previous: tab.logsPrevious,
      follow: true,
    });
    if (!args) return;

    try {
      let buffer = "";
      const process = await kubectlStreamArgsFront(
        args,
        { clusterId },
        {
          onStdoutData: (chunk: string) => {
            buffer += chunk;
            updateLogsTab(tabId, {
              logsText: buffer,
              logsLoading: false,
              logsUpdatedAt: Date.now(),
            });
          },
          onClose: () => {
            logsStreamProcesses.delete(tabId);
            scheduleStreamReconnect(tabId);
          },
          onError: (error) => {
            updateLogsTab(tabId, {
              logsLoading: false,
              logsError: error instanceof Error ? error.message : "Failed to stream logs.",
            });
          },
        },
      );
      logsStreamProcesses.set(tabId, process);
      updateLogsTab(tabId, {
        logsMode: "stream-f",
        logsLive: true,
        logsLoading: false,
      });
    } catch (error) {
      updateLogsTab(tabId, {
        logsLoading: false,
        logsError: error instanceof Error ? error.message : "Failed to start log stream.",
      });
      onError(error instanceof Error ? error.message : "Failed to start log stream.");
    }
  }

  async function saveYamlTab(tabId: string) {
    const tab = yamlTabs.find((entry) => entry.id === tabId);
    const parsed = parseWorkbenchTabId(tabId);
    if (!tab || !parsed) return;
    updateYamlTab(tabId, {
      yamlSaving: true,
      yamlError: null,
    });
    try {
      parseYaml(tab.yamlText);
      await mkdir("pods-workbench", { baseDir: BaseDirectory.AppData, recursive: true });
      const relativePath = `pods-workbench/${buildYamlFilename("pod", parsed.namespace, parsed.name)}`;
      await writeTextFile(relativePath, tab.yamlText, { baseDir: BaseDirectory.AppData });
      const filePath = await path.join(await path.appDataDir(), relativePath);
      const response = await kubectlRawArgsFront(["apply", "-f", filePath], { clusterId });
      if (response.errors) {
        throw new Error(
          formatApplyErrorMessage(response.errors, `${parsed.namespace}/${parsed.name}`),
        );
      }
      updateYamlTab(tabId, {
        originalYamlText: tab.yamlText,
        yamlSaving: false,
      });
      onMessage(`Applied YAML for ${parsed.namespace}/${parsed.name}.`);
    } catch (error) {
      let message = error instanceof Error ? error.message : "Failed to save YAML.";
      if (error instanceof YAMLException) {
        message = error.message;
      }
      updateYamlTab(tabId, {
        yamlSaving: false,
        yamlError: message,
      });
      onError(message);
    }
  }

  async function openLogsForPod(pod: Partial<PodItem>, options?: { previous?: boolean }) {
    const tabId = getTabId("logs", pod);
    if (!logsTabs.some((tab) => tab.id === tabId)) {
      logsTabs = [
        ...logsTabs,
        {
          id: tabId,
          podRef: `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
          podUid:
            pod.metadata?.uid ??
            `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
          logsText: "",
          logsError: null,
          logsLoading: false,
          logsLive: false,
          logsMode: "poll",
          logsUpdatedAt: null,
          logsPrevious: options?.previous ?? false,
          logsContainerOptions:
            pod.spec?.containers?.map((container) => container.name).filter(Boolean) ?? [],
          logsSelectedContainer: pod.spec?.containers?.[0]?.name ?? "",
          bookmarks: [],
        },
      ];
    } else if (typeof options?.previous === "boolean") {
      updateLogsTab(tabId, {
        logsPrevious: options.previous,
      });
    }
    upsertWorkbenchTab({
      id: tabId,
      kind: "logs",
      title: pod.metadata?.name ?? "unknown",
      subtitle: pod.metadata?.namespace ?? "default",
      podUid:
        pod.metadata?.uid ??
        `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
    });
    await tick();
    await refreshLogsTab(tabId);
  }

  async function openYamlForPod(pod: Partial<PodItem>) {
    const tabId = getTabId("yaml", pod);
    if (!yamlTabs.some((tab) => tab.id === tabId)) {
      yamlTabs = [
        ...yamlTabs,
        {
          id: tabId,
          podRef: `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
          podUid:
            pod.metadata?.uid ??
            `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
          originalYamlText: "",
          yamlText: "",
          yamlError: null,
          yamlLoading: true,
          yamlSaving: false,
          driftDetected: false,
          driftMessage: null,
        },
      ];
    }
    upsertWorkbenchTab({
      id: tabId,
      kind: "yaml",
      title: pod.metadata?.name ?? "unknown",
      subtitle: pod.metadata?.namespace ?? "default",
      podUid:
        pod.metadata?.uid ??
        `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
    });
    try {
      const yaml = await readPodYaml(pod);
      updateYamlTab(tabId, {
        originalYamlText: yaml,
        yamlText: yaml,
        yamlLoading: false,
        yamlError: null,
      });
    } catch (error) {
      updateYamlTab(tabId, {
        yamlLoading: false,
        yamlError: error instanceof Error ? error.message : "Failed to load pod YAML.",
      });
      onError(error instanceof Error ? error.message : "Failed to load pod YAML.");
    }
  }

  async function openEventsForPod(pod: Partial<PodItem>) {
    const tabId = getTabId("events", pod);
    if (!eventsTabs.some((tab) => tab.id === tabId)) {
      eventsTabs = [
        ...eventsTabs,
        {
          id: tabId,
          podRef: `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
          podUid:
            pod.metadata?.uid ??
            `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
          events: [],
          eventsLoading: true,
          eventsError: null,
          focusedEventIndex: null,
        },
      ];
    }
    upsertWorkbenchTab({
      id: tabId,
      kind: "events",
      title: pod.metadata?.name ?? "unknown",
      subtitle: pod.metadata?.namespace ?? "default",
      podUid:
        pod.metadata?.uid ??
        `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
    });
    try {
      const items = await loadPodEvents(clusterId, pod);
      updateEventsTab(tabId, {
        events: items,
        eventsLoading: false,
      });
    } catch (error) {
      updateEventsTab(tabId, {
        eventsLoading: false,
        eventsError: error instanceof Error ? error.message : "Failed to load events.",
      });
      onError(error instanceof Error ? error.message : "Failed to load events.");
    }
  }

  async function openInvestigateForPod(pod: Partial<PodItem>) {
    const namespace = pod.metadata?.namespace ?? "default";
    const name = pod.metadata?.name ?? "unknown";
    const logsTabId = `logs:${namespace}/${name}`;
    const yamlTabId = `yaml:${namespace}/${name}`;
    await openLogsForPod(pod);
    await openYamlForPod(pod);
    workbenchLayout = "dual";
    paneTabIds = [logsTabId, yamlTabId, null];
    activeWorkbenchTabId = logsTabId;
    onMessage(`Opened workbench for ${namespace}/${name}.`);
  }

  function persistWorkbenchState() {
    if (typeof window === "undefined" || !clusterId) return;
    const storageKey = getScopedWorkbenchStateKey();
    if (workbenchTabs.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    const payload: PersistedPodsWorkbenchState = {
      version: 1,
      tabs: orderedWorkbenchTabs
        .map((tab) => {
          const parsed = parseWorkbenchTabId(tab.id);
          if (!parsed) return null;
          return {
            kind: parsed.kind,
            name: parsed.name,
            namespace: parsed.namespace,
            pinned: pinnedTabIds.has(tab.id),
          };
        })
        .filter((tab): tab is PersistedPodsWorkbenchState["tabs"][number] => Boolean(tab)),
      activeTabId: activeWorkbenchTabId,
      layout: workbenchLayout,
      paneTabIds,
      collapsedPaneIndexes,
      closedTabs: closedWorkbenchTabs,
      workbenchCollapsed: normalizeWorkbenchVisibilityForDataMode($dashboardDataProfile, {
        workbenchCollapsed,
        collapsedPaneIndexes,
      }).workbenchCollapsed,
      workbenchFullscreen,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    window.localStorage.removeItem(getLegacyPodsWorkbenchStateKey(clusterId));
  }

  function applyWorkbenchState(state: PersistedPodsWorkbenchState | null) {
    if (!state) return;

    const recovered = recoverWorkbenchTabs({
      currentTabs: workbenchTabs,
      candidates: state.tabs
        .map((tab) => {
          const pod = Array.from(podsByUid.values()).find(
            (entry) =>
              entry.metadata?.name === tab.name && entry.metadata?.namespace === tab.namespace,
          );
          if (!pod) return null;
          return {
            id: `${tab.kind}:${tab.namespace}/${tab.name}`,
            kind: tab.kind,
            title: tab.name,
            subtitle: tab.namespace,
            podUid: pod.metadata?.uid ?? `${tab.namespace}/${tab.name}`,
          };
        })
        .filter((tab): tab is WorkbenchTab => Boolean(tab)),
      activeTabId: state.activeTabId,
    });
    if (!recovered) return;
    workbenchTabs = recovered.tabs
      .map((tab) => {
        const parsed = parseWorkbenchTabId(tab.id);
        const pod = parsed
          ? Array.from(podsByUid.values()).find(
              (entry) =>
                entry.metadata?.name === parsed.name &&
                entry.metadata?.namespace === parsed.namespace,
            )
          : null;
        if (!parsed || !pod) return null;
        return {
          ...tab,
          podUid:
            pod.metadata?.uid ??
            `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
        } satisfies WorkbenchTab;
      })
      .filter((tab): tab is WorkbenchTab => Boolean(tab));
    activeWorkbenchTabId = recovered.activeTabId;
    pinnedTabIds = new Set(
      state.tabs
        .filter((tab) => tab.pinned)
        .map((tab) => `${tab.kind}:${tab.namespace}/${tab.name}`),
    );
    workbenchLayout = state.layout;
    paneTabIds = state.paneTabIds;
    closedWorkbenchTabs = state.closedTabs;
    const normalizedVisibility = normalizeWorkbenchVisibilityForDataMode($dashboardDataProfile, {
      workbenchCollapsed: state.workbenchCollapsed,
      collapsedPaneIndexes: state.collapsedPaneIndexes,
    });
    collapsedPaneIndexes = normalizedVisibility.collapsedPaneIndexes;
    workbenchCollapsed = normalizedVisibility.workbenchCollapsed;
    workbenchFullscreen = state.workbenchFullscreen;
  }

  onMount(() => {
    if (typeof window === "undefined" || !clusterId) return;
    pendingWorkbenchState = readStoredWorkbenchState();
    lastLoadedProfileId = $dashboardDataProfile.id;
  });

  $effect(() => {
    if (!request || request.token === lastRequestToken) return;
    lastRequestToken = request.token;
    const pod = getPodForUid(request.podUid);
    if (!pod) return;

    if (request.kind === "logs") {
      void openLogsForPod(pod, { previous: request.logsPrevious });
      return;
    }
    if (request.kind === "yaml") {
      void openYamlForPod(pod);
      return;
    }
    if (request.kind === "events") {
      void openEventsForPod(pod);
      return;
    }
    void openInvestigateForPod(pod);
  });

  $effect(() => {
    if (pendingWorkbenchState === undefined) return;
    const state = pendingWorkbenchState;
    pendingWorkbenchState = null;
    applyWorkbenchState(state);
  });

  $effect(() => {
    if (!$dashboardDataProfile || $dashboardDataProfile.id !== "realtime") return;
    if (workbenchCollapsed) workbenchCollapsed = false;
    if (collapsedPaneIndexes.length > 0) collapsedPaneIndexes = [];
  });

  $effect(() => {
    if (!$dashboardDataProfile || !clusterId) return;
    if (lastLoadedProfileId === null) {
      lastLoadedProfileId = $dashboardDataProfile.id;
      return;
    }
    if (lastLoadedProfileId === $dashboardDataProfile.id) return;
    lastLoadedProfileId = $dashboardDataProfile.id;
    applyWorkbenchState(readStoredWorkbenchState($dashboardDataProfile.id));
  });

  $effect(() => {
    if (!clusterId) return;
    persistWorkbenchState();
  });

  $effect(() => {
    orderedWorkbenchTabs;
    workbenchLayout;
    ensurePaneAssignments();
  });

  onDestroy(() => {
    for (const tabId of workbenchTabs.map((tab) => tab.id)) {
      stopLogsRuntime(tabId);
    }
  });
</script>

{#if hasWorkbenchTabs}
  <MultiPaneWorkbench
    tabs={availablePaneTabs}
    activeTabId={activeWorkbenchTabId}
    {isTabPinned}
    onActivateTab={setActiveWorkbenchTab}
    onTogglePin={togglePinnedTab}
    onCloseTab={(tabId) => {
      void closeWorkbenchTab(tabId);
    }}
    onReopenLastClosedTab={reopenLastClosedTab}
    reopenDisabled={closedWorkbenchTabs.length === 0}
    layout={workbenchLayout}
    onLayoutChange={(nextLayout) => {
      void requestWorkbenchLayout(nextLayout);
    }}
    fullscreen={workbenchFullscreen}
    onToggleFullscreen={() => {
      workbenchFullscreen = !workbenchFullscreen;
    }}
    collapsed={workbenchCollapsed}
    onToggleCollapse={() => {
      workbenchCollapsed = !workbenchCollapsed;
    }}
    showTimeline={canShowIncidentTimeline}
    timelineDensity={incidentTimelineDensity}
    onTimelineDensityChange={(density) => {
      incidentTimelineDensity = density;
    }}
    timelineMarkers={visibleIncidentTimeline}
    activeTimelineMarkerId={incidentTimelineCursorId}
    onTimelineMarkerClick={jumpToIncidentMarker}
  >
    {#snippet tabActions(tab)}
      {#if tab.id.startsWith("yaml:")}
        <button
          type="button"
          class={`rounded p-2 text-xs ${
            yamlCompareSourceTabId === tab.id
              ? "bg-sky-100 text-sky-900"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onclick={() => selectYamlForCompare(tab.id)}
          title={yamlCompareSourceTabId === tab.id ? "Selected for compare" : "Select for compare"}
          aria-label={yamlCompareSourceTabId === tab.id
            ? "Selected for compare"
            : "Select for compare"}
        >
          <Target class="h-4 w-4" />
        </button>
        <button
          type="button"
          class={`rounded p-2 text-xs ${
            isYamlCompareTarget(tab.id)
              ? "bg-sky-100 text-sky-900"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          } disabled:opacity-50`}
          disabled={!canCompareWithSelected(tab.id)}
          onclick={() => compareYamlWithSelected(tab.id)}
          title={!yamlCompareSourceTabId
            ? "Set as compare source"
            : yamlCompareSourceTabId === tab.id
              ? "Clear compare source"
              : isYamlCompareTarget(tab.id)
                ? "Disable compare"
                : "Compare with selected"}
          aria-label="Compare with selected"
        >
          <GitCompareArrows class="h-4 w-4" />
        </button>
      {/if}
    {/snippet}
    {#snippet body()}
      {#if !workbenchCollapsed && activeWorkbenchTab}
        <div class={workbenchFullscreen ? "min-h-0 flex-1" : "h-[min(70dvh,760px)] min-h-[430px]"}>
          <div class="grid h-full gap-2 p-2">
            {#if getPodForUid(activeWorkbenchTab.podUid)?.metadata?.name}
              {@const activePod = getPodForUid(activeWorkbenchTab.podUid)}
              <ResourceMetricsBadge
                {clusterId}
                resourceRef={`${activePod?.metadata?.namespace ?? "default"}/${activePod?.metadata?.name}`}
                resourceType="pod"
              />
            {:else}
              <div class="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No metrics available for this pod.
              </div>
            {/if}
            <div class="flex min-h-0 flex-1 gap-2">
               {#each getPaneIndexes() as paneIndex}
                {@const paneTab = getPaneTab(paneIndex)}
                {@const renderablePaneTab = getPaneRenderableTab(paneIndex)}
                <div class={`${getPaneWrapperClass(paneIndex)} min-h-0 overflow-hidden rounded border`}>
                {#if renderablePaneTab && isPaneCollapsed(paneIndex)}
                  <PodWorkbenchPane
                    {clusterId}
                    paneTab={renderablePaneTab}
                    {logsOpen}
                    {yamlOpen}
                    {eventsOpen}
                    isVerticallyCollapsed
                    onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                    {logsJumpToLine}
                    activeLogsTabId={activeLogsTab?.id ?? null}
                    {getYamlCompareDiffLines}
                    {getPodForUid}
                    {openYamlForPod}
                    {updateLogsTab}
                    {updateYamlTab}
                    {refreshLogsTab}
                    {saveYamlTab}
                    {scheduleLogsPolling}
                    {startFollowStreamForTab}
                    {stopLogsRuntime}
                    onLogsJumpHandled={() => {
                      if (
                        renderablePaneTab.kind === "logs" &&
                        renderablePaneTab.id === activeLogsTab?.id
                      ) {
                        logsJumpToLine = null;
                      }
                    }}
                  />
                {:else}
                  <div class="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                    <span class="text-muted-foreground">Pane {paneIndex + 1}</span>
                    <select
                      class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={paneTabIds[paneIndex] ?? ""}
                      onchange={(event) => {
                        const next = [...paneTabIds] as [
                          string | null,
                          string | null,
                          string | null,
                        ];
                        const value = event.currentTarget.value;
                        next[paneIndex] = value || null;
                        if (paneIndex === 0 && value) {
                          activeWorkbenchTabId = value;
                        }
                        paneTabIds = next;
                      }}
                    >
                      <option value="">Select tab</option>
                      {#each availablePaneTabs as tab}
                        <option value={tab.id}>{tab.title} ({tab.subtitle})</option>
                      {/each}
                    </select>
                  </div>
                  {#if getPaneTabId(paneIndex) && renderablePaneTab}
                    <PodWorkbenchPane
                      paneTab={renderablePaneTab}
                      {logsOpen}
                      {yamlOpen}
                      {eventsOpen}
                      isVerticallyCollapsed={false}
                      onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                      {logsJumpToLine}
                      activeLogsTabId={activeLogsTab?.id ?? null}
                      {getYamlCompareDiffLines}
                      {getPodForUid}
                      {openYamlForPod}
                      {updateLogsTab}
                      {updateYamlTab}
                      {refreshLogsTab}
                      {saveYamlTab}
                      {scheduleLogsPolling}
                      {startFollowStreamForTab}
                      {stopLogsRuntime}
                      onLogsJumpHandled={() => {
                        if (
                          renderablePaneTab.kind === "logs" &&
                          renderablePaneTab.id === activeLogsTab?.id
                        ) {
                          logsJumpToLine = null;
                        }
                      }}
                    />
                  {:else}
                    <div
                      class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground"
                    >
                      Select tab for pane {paneIndex + 1}
                    </div>
                  {/if}
                {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    {/snippet}
  </MultiPaneWorkbench>
{/if}
