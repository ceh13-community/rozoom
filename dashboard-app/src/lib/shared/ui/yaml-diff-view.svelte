<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { MergeView } from "@codemirror/merge";
  import { Compartment, EditorState, type Extension } from "@codemirror/state";
  import { EditorView, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
  import { yaml } from "@codemirror/lang-yaml";
  import { syntaxHighlighting, indentUnit } from "@codemirror/language";
  import { appTheme, type AppTheme } from "$shared/theme";
  import { yamlSyntaxHighlight, isDarkEditorTheme } from "./yaml-editor-theme";

  interface Props {
    original: string;
    modified: string;
  }

  const { original, modified }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let mergeView: MergeView | undefined;

  // Chrome follows the app theme via CSS custom properties; the syntax
  // HighlightStyle and dark-theme facet swap through the Compartments below.
  const diffTheme = EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "12px",
      backgroundColor: "hsl(var(--background))",
    },
    ".cm-content": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "12px 0",
    },
    ".cm-gutters": {
      backgroundColor: "hsl(var(--card) / 0.5)",
      borderRight: "1px solid hsl(var(--border))",
      color: "hsl(var(--muted-foreground))",
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
      backgroundColor: "hsl(var(--primary) / 0.25) !important",
    },
  });

  const themeCompartments = [new Compartment(), new Compartment()];

  function themeExtensions(theme: AppTheme): Extension[] {
    return [
      syntaxHighlighting(yamlSyntaxHighlight(theme)),
      EditorView.darkTheme.of(isDarkEditorTheme(theme)),
    ];
  }

  function sharedExtensions(themeCompartment: Compartment) {
    return [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      indentUnit.of("  "),
      yaml(),
      themeCompartment.of(themeExtensions($appTheme)),
      diffTheme,
      EditorState.readOnly.of(true),
    ];
  }

  function createMergeView() {
    if (!container) return;
    mergeView = new MergeView({
      a: {
        doc: original,
        extensions: sharedExtensions(themeCompartments[0]),
      },
      b: {
        doc: modified,
        extensions: sharedExtensions(themeCompartments[1]),
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

  $effect(() => {
    const theme = $appTheme;
    if (!mergeView) return;
    mergeView.a.dispatch({ effects: themeCompartments[0].reconfigure(themeExtensions(theme)) });
    mergeView.b.dispatch({ effects: themeCompartments[1].reconfigure(themeExtensions(theme)) });
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
  class="yaml-diff-view h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden rounded border border-border"
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
    background-color: hsl(var(--card));
    border-left: 1px solid hsl(var(--border));
    border-right: 1px solid hsl(var(--border));
    width: 16px;
  }
</style>
