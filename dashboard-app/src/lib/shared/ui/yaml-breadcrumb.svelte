<script lang="ts">
  import type { PathSegment } from "./yaml-path";
  import type { YamlDocumentInfo } from "./yaml-documents";
  import { formatDocLabel } from "./yaml-documents";

  interface Props {
    pathSegments: PathSegment[];
    documents: YamlDocumentInfo[];
    activeDocIndex: number;
    onNavigateToLine?: (line: number) => void;
    onNavigateToDoc?: (doc: YamlDocumentInfo) => void;
    onCopyPath?: () => void;
  }

  const {
    pathSegments = [],
    documents = [],
    activeDocIndex = 0,
    onNavigateToLine,
    onNavigateToDoc,
    onCopyPath,
  }: Props = $props();

  let showDocDropdown = $state(false);

  function handleDocSelect(doc: YamlDocumentInfo) {
    showDocDropdown = false;
    onNavigateToDoc?.(doc);
  }

  function handleSegmentClick(segment: PathSegment) {
    onNavigateToLine?.(segment.line);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") showDocDropdown = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="yaml-breadcrumb flex items-center gap-1 border-b border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] font-mono">
  <!-- Multi-document navigator -->
  {#if documents.length > 1}
    <div class="relative">
      <button
        class="flex items-center gap-1 rounded px-1.5 py-0.5 text-sky-400 hover:bg-slate-800 hover:text-sky-300"
        onclick={() => { showDocDropdown = !showDocDropdown; }}
      >
        <span class="text-slate-500">doc</span>
        <span>{activeDocIndex + 1}/{documents.length}</span>
        <svg class="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.5 6l3.5 4 3.5-4z"/>
        </svg>
      </button>

      {#if showDocDropdown}
        <div class="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded border border-slate-700 bg-slate-900 py-1 shadow-lg">
          {#each documents as doc, i}
            <button
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800"
              class:bg-slate-800={i === activeDocIndex}
              onclick={() => handleDocSelect(doc)}
            >
              <span class="text-slate-500">{i + 1}.</span>
              <span class={i === activeDocIndex ? "text-sky-400" : "text-slate-300"}>
                {formatDocLabel(doc)}
              </span>
              <span class="ml-auto text-[10px] text-slate-600">L{doc.startLine}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="text-slate-600">|</span>
  {/if}

  <!-- YAML path breadcrumb -->
  <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
    {#if pathSegments.length === 0}
      <span class="text-slate-600 italic">root</span>
    {:else}
      {#each pathSegments as segment, i}
        {#if i > 0}
          <span class="text-slate-600 shrink-0">&gt;</span>
        {/if}
        <button
          class="shrink-0 rounded px-1 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-sky-300 truncate max-w-[160px]"
          title={segment.key}
          onclick={() => handleSegmentClick(segment)}
        >
          {segment.key}
        </button>
      {/each}
    {/if}
  </div>

  <!-- Copy path button -->
  {#if pathSegments.length > 0}
    <button
      class="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
      title="Copy YAML path (Ctrl+Shift+C)"
      onclick={() => onCopyPath?.()}
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="5.5" y="5.5" width="7" height="8" rx="1" />
        <path d="M3.5 10.5V3.5a1 1 0 011-1h5" />
      </svg>
    </button>
  {/if}
</div>
