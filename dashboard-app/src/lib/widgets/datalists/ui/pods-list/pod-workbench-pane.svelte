<script lang="ts">
  import type { Writable } from "svelte/store";
  import type { PodItem } from "$shared";
  import PodEventsSheet from "./pod-events-sheet.svelte";
  import ResourceLogsSheet from "../common/resource-logs-sheet.svelte";
  import ResourceYamlSheet from "../common/resource-yaml-sheet.svelte";

  type LogBookmark = {
    id: string;
    line: number;
    label: string;
    createdAt: number;
  };

  type PaneTab =
    | {
        kind: "logs";
        id: string;
        podRef: string;
        podUid: string;
        logsText: string;
        logsLoading: boolean;
        logsError: string | null;
        logsLive: boolean;
        logsMode: "poll" | "stream-f";
        logsUpdatedAt: number | null;
        logsPrevious: boolean;
        logsSelectedContainer: string;
        logsContainerOptions: string[];
        bookmarks: LogBookmark[];
      }
    | {
        kind: "yaml";
        id: string;
        podRef: string;
        podUid: string;
        originalYamlText: string;
        yamlText: string;
        yamlLoading: boolean;
        yamlSaving: boolean;
        yamlError: string | null;
        driftDetected: boolean;
        driftMessage: string | null;
      }
    | {
        kind: "events";
        id: string;
        podRef: string;
        podUid: string;
        events: import("$features/pod-details").PodEvent[];
        eventsLoading: boolean;
        eventsError: string | null;
        focusedEventIndex: number | null;
      };

  interface Props {
    clusterId?: string;
    paneTab: PaneTab;
    logsOpen: Writable<boolean>;
    yamlOpen: Writable<boolean>;
    eventsOpen: Writable<boolean>;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse: () => void;
    logsJumpToLine: number | null;
    activeLogsTabId: string | null;
    getYamlCompareDiffLines: (tabId: string) => number[];
    getPodForUid: (podUid: string) => Partial<PodItem> | null;
    openYamlForPod: (pod: Partial<PodItem>) => Promise<void>;
    updateLogsTab: (
      tabId: string,
      patch: Partial<Extract<PaneTab, { kind: "logs" }>>,
    ) => void;
    updateYamlTab: (
      tabId: string,
      patch: Partial<Extract<PaneTab, { kind: "yaml" }>>,
    ) => void;
    refreshLogsTab: (tabId: string) => Promise<void>;
    saveYamlTab: (tabId: string) => Promise<void>;
    scheduleLogsPolling: (tabId: string) => void;
    startFollowStreamForTab: (tabId: string) => Promise<void>;
    stopLogsRuntime: (tabId: string) => void;
    onLogsJumpHandled: () => void;
  }

  let {
    clusterId,
    paneTab,
    logsOpen,
    yamlOpen,
    eventsOpen,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse,
    logsJumpToLine,
    activeLogsTabId,
    getYamlCompareDiffLines,
    getPodForUid,
    openYamlForPod,
    updateLogsTab,
    updateYamlTab,
    refreshLogsTab,
    saveYamlTab,
    scheduleLogsPolling,
    startFollowStreamForTab,
    stopLogsRuntime,
    onLogsJumpHandled,
  }: Props = $props();
</script>

{#if paneTab.kind === "logs"}
  <ResourceLogsSheet
    embedded
    {clusterId}
    isOpen={logsOpen}
    podRef={paneTab.podRef}
    logs={paneTab.logsText}
    loading={paneTab.logsLoading}
    error={paneTab.logsError}
    isLive={paneTab.logsLive}
    mode={paneTab.logsMode}
    lastUpdatedAt={paneTab.logsUpdatedAt}
    previous={paneTab.logsPrevious}
    selectedContainer={paneTab.logsSelectedContainer}
    containerOptions={paneTab.logsContainerOptions}
    bookmarks={paneTab.bookmarks}
    canVerticalCollapse={true}
    {isVerticallyCollapsed}
    {onToggleVerticalCollapse}
    onToggleLive={() => {
      const nextLive = !paneTab.logsLive;
      updateLogsTab(paneTab.id, { logsLive: nextLive });
      if (!nextLive) {
        stopLogsRuntime(paneTab.id);
        return;
      }
      if (paneTab.logsMode === "stream-f") {
        void startFollowStreamForTab(paneTab.id);
        return;
      }
      scheduleLogsPolling(paneTab.id);
    }}
    onSetMode={(mode) => {
      updateLogsTab(paneTab.id, { logsMode: mode });
      if (mode === "stream-f" && paneTab.logsLive) {
        void startFollowStreamForTab(paneTab.id);
      }
    }}
    onTogglePrevious={() => {
      updateLogsTab(paneTab.id, {
        logsPrevious: !paneTab.logsPrevious,
      });
      void refreshLogsTab(paneTab.id);
    }}
    onSelectContainer={(container) => {
      updateLogsTab(paneTab.id, { logsSelectedContainer: container });
      void refreshLogsTab(paneTab.id);
    }}
    onRefresh={() => {
      void refreshLogsTab(paneTab.id);
    }}
    onAddBookmark={(line) => {
      updateLogsTab(paneTab.id, {
        bookmarks: [
          ...paneTab.bookmarks,
          {
            id: `${Date.now()}:${line}`,
            line,
            label: `Line ${line}`,
            createdAt: Date.now(),
          },
        ],
      });
    }}
    onRemoveBookmark={(bookmarkId) => {
      updateLogsTab(paneTab.id, {
        bookmarks: paneTab.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
      });
    }}
    jumpToLine={paneTab.id === activeLogsTabId ? logsJumpToLine : null}
    onJumpHandled={onLogsJumpHandled}
  />
{:else if paneTab.kind === "yaml"}
  <ResourceYamlSheet
    embedded
    {clusterId}
    isOpen={yamlOpen}
    podRef={paneTab.podRef}
    originalYaml={paneTab.originalYamlText}
    yamlText={paneTab.yamlText}
    loading={paneTab.yamlLoading}
    saving={paneTab.yamlSaving}
    hasChanges={paneTab.yamlText !== paneTab.originalYamlText}
    error={paneTab.yamlError}
    driftDetected={paneTab.driftDetected}
    driftMessage={paneTab.driftMessage}
    externalDiffLines={getYamlCompareDiffLines(paneTab.id)}
    canVerticalCollapse={true}
    {isVerticallyCollapsed}
    {onToggleVerticalCollapse}
    onYamlChange={(value) => {
      updateYamlTab(paneTab.id, { yamlText: value });
    }}
    onRefresh={() => {
      const pod = getPodForUid(paneTab.podUid);
      if (pod) void openYamlForPod(pod);
    }}
    onSave={() => {
      void saveYamlTab(paneTab.id);
    }}
  />
{:else}
  <PodEventsSheet
    embedded
    isOpen={eventsOpen}
    podRef={paneTab.podRef}
    events={paneTab.events}
    loading={paneTab.eventsLoading}
    error={paneTab.eventsError}
    focusedEventIndex={paneTab.focusedEventIndex}
    canVerticalCollapse={true}
    {isVerticallyCollapsed}
    {onToggleVerticalCollapse}
  />
{/if}
