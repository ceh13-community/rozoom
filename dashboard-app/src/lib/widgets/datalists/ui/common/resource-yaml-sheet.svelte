<script lang="ts">
  import { load as parseYaml } from "js-yaml";
  import type { Writable } from "svelte/store";
  import { Button } from "$shared/ui/button";
  import YamlEditor from "$shared/ui/yaml-editor.svelte";
  import YamlBreadcrumb from "$shared/ui/yaml-breadcrumb.svelte";
  import YamlDiffView from "$shared/ui/yaml-diff-view.svelte";
  import ResourceMetricsBadge from "../common/resource-metrics-badge.svelte";
  import WorkbenchSheetShell from "../common/workbench-sheet-shell.svelte";
  import type { PathSegment } from "$shared/ui/yaml-path";
  import { formatYamlPathDot } from "$shared/ui/yaml-path";
  import type { YamlDocumentInfo } from "$shared/ui/yaml-documents";

  interface ResourceYamlSheetProps {
    embedded?: boolean;
    isOpen: Writable<boolean>;
    clusterId?: string;
    podRef: string;
    originalYaml: string;
    yamlText: string;
    loading: boolean;
    saving: boolean;
    hasChanges?: boolean;
    error: string | null;
    driftDetected?: boolean;
    driftMessage?: string | null;
    onYamlChange: (value: string) => void;
    onRefresh: () => void;
    onSave: () => void;
    onReloadFromCluster?: () => void;
    onRebaseEdits?: () => void;
    canVerticalCollapse?: boolean;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse?: () => void;
    externalDiffLines?: number[];
    showBreadcrumb?: boolean;
  }

  const {
    embedded = false,
    isOpen,
    clusterId,
    podRef,
    originalYaml,
    yamlText,
    loading,
    saving,
    hasChanges = false,
    error,
    driftDetected = false,
    driftMessage = null,
    onYamlChange,
    onRefresh,
    onSave,
    onReloadFromCluster = () => {},
    onRebaseEdits = () => {},
    canVerticalCollapse = false,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse = () => {},
    externalDiffLines = [],
    showBreadcrumb = true,
  }: ResourceYamlSheetProps = $props();

  let isFullscreen = $state(false);
  let showDirtyDiff = $state(false);
  let pathSegments = $state<PathSegment[]>([]);
  let documents = $state<YamlDocumentInfo[]>([]);
  let activeDocIndex = $state(0);
  let editorRef = $state<ReturnType<typeof YamlEditor> | null>(null);

  const lines = $derived(yamlText.replace(/\r\n/g, "\n").split("\n"));
  const originalLines = $derived(originalYaml.replace(/\r\n/g, "\n").split("\n"));

  const hasSyntaxError = $derived.by(() => {
    try {
      if (yamlText.trim()) parseYaml(yamlText);
      return false;
    } catch {
      return true;
    }
  });

  const dirtySummary = $derived.by(() => {
    const changed: number[] = [];
    const maxLines = Math.max(lines.length, originalLines.length);
    for (let idx = 0; idx < maxLines; idx += 1) {
      const current = lines[idx] ?? "";
      const initial = originalLines[idx] ?? "";
      if (current !== initial) {
        changed.push(idx + 1);
      }
    }
    return {
      changedCount: changed.length,
      changedLines: changed,
    };
  });

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (!isFullscreen) return;
    isFullscreen = false;
  }

  function getCollapsedLabel() {
    if (!podRef) return "YAML";
    const segments = podRef.split("/");
    return segments[segments.length - 1] || podRef;
  }

  function handlePathChange(segments: PathSegment[]) {
    pathSegments = segments;
  }

  function handleDocumentsChange(docs: YamlDocumentInfo[], idx: number) {
    documents = docs;
    activeDocIndex = idx;
  }

  function handleNavigateToLine(line: number) {
    editorRef?.navigateToLine(line);
  }

  function handleNavigateToDoc(doc: YamlDocumentInfo) {
    editorRef?.navigateToLine(doc.startLine);
  }

  function handleCopyPath() {
    if (editorRef?.copyPathAtCursor()) return;
    if (pathSegments.length === 0) return;
    const dotPath = formatYamlPathDot(pathSegments);
    navigator.clipboard.writeText(dotPath);
  }

  function handleToggleLintPanel() {
    editorRef?.toggleLintPanel();
  }

  let yamlCopied = $state(false);
  let yamlCopyTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleCopyYaml() {
    if (!yamlText.trim()) return;
    try {
      await navigator.clipboard.writeText(yamlText);
      yamlCopied = true;
      if (yamlCopyTimer) clearTimeout(yamlCopyTimer);
      yamlCopyTimer = setTimeout(() => {
        yamlCopied = false;
      }, 1500);
    } catch {
      // clipboard may be unavailable (e.g. insecure context) — silently ignore
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<WorkbenchSheetShell
  {embedded}
  {isOpen}
  title={`Resource YAML: ${podRef || "-"}`}
  collapsedLabel={getCollapsedLabel()}
  standaloneMaxWidthClass="sm:max-w-[92vw]"
  {canVerticalCollapse}
  {isVerticallyCollapsed}
  {onToggleVerticalCollapse}
  {isFullscreen}
  onToggleFullscreen={toggleFullscreen}
>
  {#snippet headerActions()}
    <Button
      variant="outline"
      size="sm"
      onclick={() => onRefresh()}
      {loading}
      loadingLabel="Loading"
      disabled={saving || !podRef}
    >
      Refresh
    </Button>
    <Button
      variant={hasChanges ? "default" : "outline"}
      class={hasChanges ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}
      size="sm"
      onclick={() => onSave()}
      loading={saving}
      loadingLabel="Applying"
      disabled={loading ||
        !yamlText.trim() ||
        !hasChanges ||
        hasSyntaxError ||
        (embedded && driftDetected)}
    >
      Apply
    </Button>
    {#if clusterId && podRef}
      <ResourceMetricsBadge {clusterId} resourceRef={podRef} resourceType="pod" />
    {/if}
  {/snippet}

  {#snippet toolbar()}
    <Button
      variant={showDirtyDiff && dirtySummary.changedCount > 0 ? "default" : "outline"}
      size="sm"
      onclick={() => {
        showDirtyDiff = !showDirtyDiff;
      }}
    >
      Dirty diff: {dirtySummary.changedCount}
    </Button>
    <Button
      variant="outline"
      size="sm"
      onclick={handleCopyPath}
      disabled={pathSegments.length === 0}
      title="Copy YAML path at cursor"
    >
      Copy path <span class="ml-1.5 text-[10px] text-muted-foreground">Ctrl+Shift+C</span>
    </Button>
    <Button variant="outline" size="sm" onclick={handleToggleLintPanel} title="Toggle lint panel">
      Lint panel <span class="ml-1.5 text-[10px] text-muted-foreground">Ctrl+Shift+M</span>
    </Button>
    <Button
      variant="outline"
      size="sm"
      onclick={handleCopyYaml}
      disabled={!yamlText.trim()}
      title="Copy full YAML (cleaned, ready to commit)"
    >
      {yamlCopied ? "Copied" : "Copy YAML"}
    </Button>
  {/snippet}

  {#if error}
    <div
      class="mx-4 mt-3 rounded border border-rose-300/80 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/20 dark:text-rose-100"
    >
      {error}
    </div>
  {/if}
  {#if driftDetected}
    <div
      class="mx-4 mt-3 rounded border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200"
    >
      <div>{driftMessage || "Resource changed in cluster since this tab was opened."}</div>
      <div class="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={() => onReloadFromCluster()}
          disabled={loading || saving}
        >
          Reload from cluster
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={() => onRebaseEdits()}
          disabled={loading || saving}
        >
          Rebase my edits
        </Button>
      </div>
    </div>
  {/if}

  <!-- Breadcrumb bar with YAML path + multi-doc navigator -->
  {#if showBreadcrumb}
    <div class="mx-4 mt-3">
      <YamlBreadcrumb
        {pathSegments}
        {documents}
        {activeDocIndex}
        onNavigateToLine={handleNavigateToLine}
        onNavigateToDoc={handleNavigateToDoc}
        onCopyPath={handleCopyPath}
      />
    </div>
  {/if}

  <div class="min-h-0 flex flex-1 overflow-hidden p-4 pt-2">
    {#if showDirtyDiff && dirtySummary.changedCount > 0}
      <!-- Side-by-side diff view using @codemirror/merge -->
      <YamlDiffView original={originalYaml} modified={yamlText} />
    {:else}
      <div class="min-h-0 flex flex-1 overflow-hidden">
        <YamlEditor
          bind:this={editorRef}
          value={yamlText}
          readonly={saving}
          onChange={onYamlChange}
          onSave={() => onSave()}
          onPathChange={handlePathChange}
          onDocumentsChange={handleDocumentsChange}
          diffLines={externalDiffLines}
        />
      </div>
    {/if}
  </div>
</WorkbenchSheetShell>
