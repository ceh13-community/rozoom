<script lang="ts">
  import type { Writable } from "svelte/store";
  import type { PodItem } from "$shared";
  import PodEventsSheet from "./pod-events-sheet.svelte";
  import ResourceLogsSheet from "../common/resource-logs-sheet.svelte";
  import ResourceYamlSheet from "../common/resource-yaml-sheet.svelte";
  import PortForwardBrowserTab from "../common/port-forward-browser-tab.svelte";
  import { previousLogsAvailability } from "./model/previous-logs";

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
      }
    | {
        kind: "port-forward";
        id: string;
        podRef: string;
        podUid: string;
        url: string;
        message: string | null;
        loading: boolean;
        stopping: boolean;
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
    /** Runs the stream, polling or one read the tab's settings ask for. */
    restartLogsTab: (tabId: string) => void;
    onLogsJumpHandled: () => void;
    portForwardActions?: {
      copyUrl: (tabId: string) => void;
      openWeb: (tabId: string) => void;
      openExternal: (tabId: string) => void;
      refresh: (tabId: string) => void;
      stop: (tabId: string) => void;
    };
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
    restartLogsTab,
    onLogsJumpHandled,
    portForwardActions,
  }: Props = $props();

  const previousLogs = $derived(
    paneTab.kind === "logs"
      ? previousLogsAvailability(getPodForUid(paneTab.podUid), paneTab.logsSelectedContainer)
      : null,
  );
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
    previousAvailable={previousLogs?.available ?? true}
    previousHint={previousLogs?.hint ?? ""}
    onToggleLive={() => {
      updateLogsTab(paneTab.id, { logsLive: !paneTab.logsLive });
      restartLogsTab(paneTab.id);
    }}
    onSetMode={(mode) => {
      if (mode === paneTab.logsMode) return;
      updateLogsTab(paneTab.id, { logsMode: mode });
      restartLogsTab(paneTab.id);
    }}
    onTogglePrevious={() => {
      updateLogsTab(paneTab.id, {
        logsPrevious: !paneTab.logsPrevious,
      });
      restartLogsTab(paneTab.id);
    }}
    onSelectContainer={(container) => {
      // A container without an earlier instance cannot keep Previous on.
      const keepPrevious =
        paneTab.logsPrevious &&
        previousLogsAvailability(getPodForUid(paneTab.podUid), container).available;
      updateLogsTab(paneTab.id, { logsSelectedContainer: container, logsPrevious: keepPrevious });
      restartLogsTab(paneTab.id);
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
{:else if paneTab.kind === "port-forward"}
  <!-- Same panel as a Service port-forward tab: Copy URL, Open Web, Open external, Stop. -->
  <PortForwardBrowserTab
    title={`Web ${paneTab.podRef}`}
    url={paneTab.url}
    loading={paneTab.loading}
    message={paneTab.message}
    onRefresh={() => portForwardActions?.refresh(paneTab.id)}
    onCopyUrl={() => portForwardActions?.copyUrl(paneTab.id)}
    onOpenPreview={() => portForwardActions?.openWeb(paneTab.id)}
    onOpenExternal={() => portForwardActions?.openExternal(paneTab.id)}
    onStop={() => portForwardActions?.stop(paneTab.id)}
    stopBusy={paneTab.stopping}
    stopLabel="Stopping..."
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
