<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { Writable } from "svelte/store";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import { timeAgo } from "$shared/lib/timeFormatters";
  import { summarizeLogAlerts, type LogAlertSummary } from "$features/pods-workbench";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Bookmark from "@lucide/svelte/icons/bookmark";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Copy from "@lucide/svelte/icons/copy";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import X from "@lucide/svelte/icons/x";
  import ResourceMetricsBadge from "../common/resource-metrics-badge.svelte";
  import WorkbenchSheetShell from "../common/workbench-sheet-shell.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  type LogBookmark = {
    id: string;
    line: number;
    label: string;
    createdAt: number;
  };

  interface ResourceLogsSheetProps {
    embedded?: boolean;
    isOpen: Writable<boolean>;
    clusterId?: string;
    podRef: string;
    logs: string;
    loading: boolean;
    error: string | null;
    isLive: boolean;
    mode: "poll" | "stream-f";
    lastUpdatedAt: number | null;
    previous: boolean;
    selectedContainer: string;
    containerOptions: string[];
    bookmarks: LogBookmark[];
    onToggleLive: () => void;
    onSetMode: (mode: "poll" | "stream-f") => void;
    onTogglePrevious: () => void;
    onSelectContainer: (container: string) => void;
    onRefresh: () => void;
    onAddBookmark: (line: number) => void;
    onRemoveBookmark: (bookmarkId: string) => void;
    jumpToLine: number | null;
    onJumpHandled: () => void;
    canVerticalCollapse?: boolean;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse?: () => void;
  }

  type LineChunk = {
    text: string;
    match: boolean;
  };

  const {
    embedded = false,
    isOpen,
    clusterId,
    podRef,
    logs,
    loading,
    error,
    isLive,
    mode,
    lastUpdatedAt,
    previous,
    selectedContainer,
    containerOptions,
    bookmarks,
    onToggleLive,
    onSetMode,
    onTogglePrevious,
    onSelectContainer,
    onRefresh,
    onAddBookmark,
    onRemoveBookmark,
    jumpToLine,
    onJumpHandled,
    canVerticalCollapse = false,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse = () => {},
  }: ResourceLogsSheetProps = $props();

  const LINE_HEIGHT = 18;
  const BUFFER_LINES = 40;

  let logContainer = $state<HTMLDivElement | null>(null);
  let searchQuery = $state("");
  let followTail = $state(true);
  let copied = $state(false);
  let isFullscreen = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTop = $state(0);
  let containerHeight = $state(400);
  let currentMatchIndex = $state(-1);

  const allLines = $derived(logs ? logs.replace(/\r\n/g, "\n").split("\n") : []);
  const totalHeight = $derived(allLines.length * LINE_HEIGHT);
  const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
  const alertSummaries = $derived(summarizeLogAlerts(logs));

  const matchLineIndices = $derived.by(() => {
    if (!normalizedSearch) return [] as number[];
    const indices: number[] = [];
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].toLowerCase().includes(normalizedSearch)) {
        indices.push(i);
      }
    }
    return indices;
  });

  const matchLineSet = $derived(new Set(matchLineIndices));

  $effect(() => {
    if (matchLineIndices.length === 0) {
      currentMatchIndex = -1;
    } else if (currentMatchIndex >= matchLineIndices.length || currentMatchIndex < 0) {
      currentMatchIndex = 0;
    }
  });

  const visibleRange = $derived.by(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER_LINES);
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT);
    const end = Math.min(allLines.length, start + visibleCount + BUFFER_LINES * 2);
    return { start, end };
  });

  const visibleLines = $derived.by(() => {
    const { start, end } = visibleRange;
    const result: { line: string; index: number }[] = [];
    for (let i = start; i < end; i++) {
      result.push({ line: allLines[i], index: i });
    }
    return result;
  });

  const lineNumberWidth = $derived(Math.max(4, String(allLines.length).length));

  function splitLineByQuery(line: string, query: string): LineChunk[] {
    if (!query) return [{ text: line, match: false }];
    const lowerLine = line.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const chunks: LineChunk[] = [];
    let cursor = 0;

    while (cursor < line.length) {
      const foundAt = lowerLine.indexOf(lowerQuery, cursor);
      if (foundAt === -1) {
        chunks.push({ text: line.slice(cursor), match: false });
        break;
      }
      if (foundAt > cursor) {
        chunks.push({ text: line.slice(cursor, foundAt), match: false });
      }
      const end = foundAt + lowerQuery.length;
      chunks.push({ text: line.slice(foundAt, end), match: true });
      cursor = end;
    }

    if (chunks.length === 0) {
      chunks.push({ text: line, match: false });
    }

    return chunks;
  }

  $effect(() => {
    if (logContainer) {
      containerHeight = logContainer.clientHeight;
    }
  });

  $effect(() => {
    logs;
    followTail;
    if (!followTail) return;
    tick().then(() => {
      if (!logContainer) return;
      logContainer.scrollTop = logContainer.scrollHeight;
    });
  });

  $effect(() => {
    jumpToLine;
    if (!jumpToLine || jumpToLine < 1) return;
    scrollToLine(jumpToLine);
    onJumpHandled();
  });

  function handleLogScroll() {
    if (!logContainer) return;
    scrollTop = logContainer.scrollTop;
    const thresholdPx = 24;
    const distanceToBottom =
      logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight;
    followTail = distanceToBottom <= thresholdPx;
  }

  function scrollToLine(lineNumber: number) {
    if (!logContainer || lineNumber < 1) return;
    const targetTop = (lineNumber - 1) * LINE_HEIGHT - logContainer.clientHeight * 0.25;
    logContainer.scrollTop = Math.max(0, targetTop);
    followTail = false;
  }

  function jumpToLatest() {
    if (!logContainer) return;
    logContainer.scrollTop = logContainer.scrollHeight;
    followTail = true;
  }

  function goToNextMatch() {
    if (matchLineIndices.length === 0) return;
    const next = currentMatchIndex < 0 ? 0 : (currentMatchIndex + 1) % matchLineIndices.length;
    currentMatchIndex = next;
    scrollToLine(matchLineIndices[next] + 1);
  }

  function goToPrevMatch() {
    if (matchLineIndices.length === 0) return;
    const prev = currentMatchIndex <= 0 ? matchLineIndices.length - 1 : currentMatchIndex - 1;
    currentMatchIndex = prev;
    scrollToLine(matchLineIndices[prev] + 1);
  }

  function addBookmarkAtTail() {
    if (allLines.length === 0) return;
    onAddBookmark(allLines.length);
    scrollToLine(allLines.length);
  }

  function openAlert(alert: LogAlertSummary) {
    scrollToLine(alert.firstLine);
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (!isFullscreen) return;
    isFullscreen = false;
  }

  function getCollapsedLabel() {
    if (!podRef) return "Logs";
    const segments = podRef.split("/");
    return segments[segments.length - 1] || podRef;
  }

  async function copyLogs() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(logs || "");
      copied = true;
      if (copyTimer) {
        clearTimeout(copyTimer);
      }
      copyTimer = setTimeout(() => {
        copied = false;
      }, 1500);
    } catch {
      copied = false;
    }
  }

  function handleResize() {
    if (!logContainer) return;
    containerHeight = logContainer.clientHeight;
  }

  onDestroy(() => {
    if (!copyTimer) return;
    clearTimeout(copyTimer);
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} onresize={handleResize} />

<WorkbenchSheetShell
  {embedded}
  {isOpen}
  title={`Pod logs: ${podRef || "-"}`}
  collapsedLabel={getCollapsedLabel()}
  standaloneMaxWidthClass="sm:max-w-[75vw]"
  {canVerticalCollapse}
  {isVerticallyCollapsed}
  {onToggleVerticalCollapse}
  {isFullscreen}
  onToggleFullscreen={toggleFullscreen}
>
  {#snippet headerActions()}
    <Button variant={isLive ? "default" : "outline"} size="sm" onclick={() => onToggleLive()}>
      {#if isLive}
        <Pause class="mr-1 h-3.5 w-3.5" /> Stop
      {:else}
        <Play class="mr-1 h-3.5 w-3.5" /> Start
      {/if}
    </Button>
    <Button
      variant="outline"
      size="sm"
      onclick={() => onRefresh()}
      loading={loading}
      loadingLabel="Loading"
      disabled={!podRef}
    >
      <RotateCw class="mr-1 h-3.5 w-3.5" /> Refresh
    </Button>
    <Button variant="outline" size="sm" onclick={copyLogs} disabled={!logs}>
      <Copy class="mr-1 h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
    </Button>
    {#if clusterId && podRef}
      <ResourceMetricsBadge {clusterId} resourceRef={podRef} resourceType="pod" />
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <div class="flex items-center gap-1.5">
      <Input class="max-w-[220px]" placeholder="Search in logs..." bind:value={searchQuery} />
      <Button variant="outline" size="sm" onclick={goToPrevMatch} disabled={matchLineIndices.length === 0} title="Previous match">
        <ChevronUp class="h-3.5 w-3.5" />
      </Button>
      <Button variant="outline" size="sm" onclick={goToNextMatch} disabled={matchLineIndices.length === 0} title="Next match">
        <ChevronDown class="h-3.5 w-3.5" />
      </Button>
      {#if normalizedSearch}
        <div class="text-xs text-muted-foreground">
          {matchLineIndices.length > 0 ? `${currentMatchIndex + 1}/${matchLineIndices.length}` : "0"} matches
        </div>
      {/if}
    </div>
    <div class="inline-flex items-center rounded border bg-background p-1">
      <button
        type="button"
        class={`rounded px-2 py-1 text-xs ${mode === "poll" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        onclick={() => onSetMode("poll")}
      >
        Poll
      </button>
      <button
        type="button"
        class={`rounded px-2 py-1 text-xs ${mode === "stream-f" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        onclick={() => onSetMode("stream-f")}
      >
        Stream (-f)
      </button>
    </div>
    <select
      class="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100"
      value={selectedContainer}
      onchange={(event) => onSelectContainer(event.currentTarget.value)}
    >
      <option value="__all__">All containers</option>
      {#each containerOptions as containerName}
        <option value={containerName}>{containerName}</option>
      {/each}
    </select>
    <Button variant={previous ? "default" : "outline"} size="sm" onclick={() => onTogglePrevious()}>
      {previous ? "Previous: On" : "Previous: Off"}
    </Button>
    <div class="text-xs text-muted-foreground">{allLines.length} lines</div>
    <Button variant="outline" size="sm" onclick={addBookmarkAtTail} disabled={allLines.length === 0}>
      <Bookmark class="mr-1 h-3.5 w-3.5" /> Bookmark
    </Button>
    {#if !followTail}
      <Button variant="outline" size="sm" onclick={jumpToLatest}>Jump to latest</Button>
    {/if}
    <div class={`text-xs ${isLive ? "text-emerald-600" : "text-muted-foreground"}`}>
      {isLive ? "Live" : "Paused"}
    </div>
    <div class="text-xs text-muted-foreground">
      {mode === "stream-f" ? "Mode: Stream (-f)" : "Mode: Poll"}
    </div>
    {#if lastUpdatedAt}
      <div class="text-xs text-muted-foreground">Updated {timeAgo(new Date(lastUpdatedAt))}</div>
    {/if}
  {/snippet}

  {#if alertSummaries.length > 0 || bookmarks.length > 0}
    <div class="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      {#if alertSummaries.length > 0}
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Smart alerts</div>
        {#each alertSummaries as alert}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded border border-amber-300/50 bg-amber-100/30 px-2 py-1 text-xs text-amber-900 hover:bg-amber-200/40 dark:text-amber-200"
            onclick={() => openAlert(alert)}
            title={`Jump to first ${alert.label} (line ${alert.firstLine})`}
          >
            <AlertTriangle class="h-3.5 w-3.5" />
            {alert.label} {alert.count}
          </button>
        {/each}
      {/if}
      {#if bookmarks.length > 0}
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Bookmarks</div>
        {#each bookmarks as bookmark}
          <div class="inline-flex items-center rounded border px-2 py-1 text-xs">
            <button
              type="button"
              class="inline-flex items-center gap-1 text-foreground hover:text-primary"
              onclick={() => scrollToLine(bookmark.line)}
              title={`Jump to line ${bookmark.line}`}
            >
              <Bookmark class="h-3.5 w-3.5" />
              {bookmark.label}
            </button>
            <button
              type="button"
              class="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onclick={() => onRemoveBookmark(bookmark.id)}
              aria-label={`Remove bookmark ${bookmark.label}`}
              title="Remove bookmark"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <div
    class="log-viewport min-h-0 flex-1 overflow-auto bg-slate-950 font-mono text-xs text-emerald-300"
    bind:this={logContainer}
    onscroll={handleLogScroll}
  >
    {#if error}
      <div class="mx-4 mt-3 mb-2 rounded border border-rose-300/80 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/20 dark:text-rose-100">
        {error}
      </div>
    {/if}
    {#if loading && !logs}
      <div class="px-4 py-3">Loading logs<LoadingDots /></div>
    {:else if allLines.length > 0}
      <div style="height: {totalHeight}px; position: relative;">
        {#each visibleLines as entry (entry.index)}
          {@const lineNo = entry.index + 1}
          {@const isMatch = matchLineSet.has(entry.index)}
          {@const isCurrentMatch = currentMatchIndex >= 0 && matchLineIndices[currentMatchIndex] === entry.index}
          <div
            data-log-line={lineNo}
            class="log-line flex {isCurrentMatch ? 'bg-amber-400/20' : isMatch ? 'bg-amber-200/10' : ''}"
            style="position: absolute; top: {entry.index * LINE_HEIGHT}px; left: 0; right: 0; height: {LINE_HEIGHT}px;"
          >
            <span
              class="log-line-number select-none text-right text-slate-600"
              style="width: {lineNumberWidth + 1}ch; min-width: {lineNumberWidth + 1}ch;"
            >
              {lineNo}
            </span>
            <span class="flex-1 truncate pl-2">
              {#if normalizedSearch && entry.line}
                {#each splitLineByQuery(entry.line, normalizedSearch) as chunk}
                  <span class={chunk.match ? "rounded bg-amber-300/40 text-amber-100" : ""}>{chunk.text}</span>
                {/each}
              {:else}
                {entry.line || " "}
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="px-4 py-3">No logs available.</div>
    {/if}
  </div>
</WorkbenchSheetShell>

<style>
  .log-viewport {
    contain: layout paint;
  }
  .log-line {
    line-height: 18px;
    font-size: 12px;
    padding: 0 12px;
  }
  .log-line-number {
    font-variant-numeric: tabular-nums;
  }
</style>
