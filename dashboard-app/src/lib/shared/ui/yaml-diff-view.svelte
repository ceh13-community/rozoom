<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { MergeView } from "@codemirror/merge";
  import { EditorState } from "@codemirror/state";
  import { EditorView, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
  import { yaml } from "@codemirror/lang-yaml";
  import { syntaxHighlighting, indentUnit, HighlightStyle } from "@codemirror/language";
  import { tags } from "@lezer/highlight";

  interface Props {
    original: string;
    modified: string;
  }

  const { original, modified }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let mergeView: MergeView | undefined;

  const diffHighlight = HighlightStyle.define([
    { tag: tags.propertyName, color: "#7dd3fc" },
    { tag: tags.string, color: "#fde68a" },
    { tag: tags.number, color: "#c4b5fd" },
    { tag: tags.bool, color: "#f9a8d4" },
    { tag: tags.null, color: "#94a3b8" },
    { tag: tags.comment, color: "#6ee7b7" },
    { tag: tags.keyword, color: "#93c5fd" },
    { tag: tags.operator, color: "#cbd5e1" },
    { tag: tags.punctuation, color: "#94a3b8" },
    { tag: tags.meta, color: "#94a3b8" },
  ]);

  const diffTheme = EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "12px",
      backgroundColor: "#020617",
    },
    ".cm-content": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "12px 0",
    },
    ".cm-gutters": {
      backgroundColor: "#0f172a80",
      borderRight: "1px solid #1e293b",
      color: "#64748b",
      minWidth: "40px",
    },
    ".cm-changedLine": {
      backgroundColor: "#fbbf2415 !important",
    },
    ".cm-changedText": {
      backgroundColor: "#fbbf2430 !important",
    },
    ".cm-insertedLine": {
      backgroundColor: "#22c55e15 !important",
    },
    ".cm-insertedText": {
      backgroundColor: "#22c55e30 !important",
    },
    ".cm-deletedLine": {
      backgroundColor: "#ef444415 !important",
    },
    ".cm-deletedText": {
      backgroundColor: "#ef444430 !important",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "#334155 !important",
    },
  });

  function sharedExtensions() {
    return [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      indentUnit.of("  "),
      yaml(),
      syntaxHighlighting(diffHighlight),
      diffTheme,
      EditorState.readOnly.of(true),
    ];
  }

  function createMergeView() {
    if (!container) return;
    mergeView = new MergeView({
      a: {
        doc: original,
        extensions: sharedExtensions(),
      },
      b: {
        doc: modified,
        extensions: sharedExtensions(),
      },
      parent: container,
    });
  }

  $effect(() => {
    if (!mergeView) return;
    const a = original;
    const b = modified;
    // Update docs if they changed
    const viewA = mergeView.a;
    const viewB = mergeView.b;
    if (viewA.state.doc.toString() !== a) {
      viewA.dispatch({ changes: { from: 0, to: viewA.state.doc.length, insert: a } });
    }
    if (viewB.state.doc.toString() !== b) {
      viewB.dispatch({ changes: { from: 0, to: viewB.state.doc.length, insert: b } });
    }
  });

  onMount(() => {
    createMergeView();
  });

  onDestroy(() => {
    mergeView?.destroy();
  });
</script>

<div
  bind:this={container}
  class="yaml-diff-view h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden rounded border border-slate-700"
></div>

<style>
  .yaml-diff-view :global(.cm-mergeView) {
    height: 100%;
  }
  .yaml-diff-view :global(.cm-mergeViewEditor) {
    height: 100%;
    overflow: auto;
  }
  .yaml-diff-view :global(.cm-editor) {
    height: 100%;
  }
  .yaml-diff-view :global(.cm-scroller) {
    overflow: auto;
  }
  .yaml-diff-view :global(.cm-mergeViewGutter) {
    background-color: #0f172a;
    border-left: 1px solid #1e293b;
    border-right: 1px solid #1e293b;
    width: 16px;
  }
</style>
