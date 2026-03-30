<script lang="ts">
  import KeyValueExpand from "./key-value-expand.svelte";

  type MetadataField = {
    label: string;
    value?: string | number;
    lines?: string[];
    colSpan?: 1 | 2;
    valueClass?: string;
  };

  interface DetailsMetadataGridProps {
    fields?: MetadataField[];
    labels?: Array<[string, string]>;
    annotations?: Array<[string, string]>;
    contextKey: string;
    labelsEmptyText?: string;
    annotationsEmptyText?: string;
  }

  const {
    fields = [],
    labels = [],
    annotations = [],
    contextKey,
    labelsEmptyText = "No labels.",
    annotationsEmptyText = "No annotations.",
  }: DetailsMetadataGridProps = $props();
</script>

<div class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
  {#each fields as field}
    <div class={`rounded border p-3 ${field.colSpan === 2 ? "sm:col-span-2" : ""}`}>
      <div class="text-xs text-muted-foreground">{field.label}</div>
      {#if (field.lines ?? []).length > 0}
        <div class="mt-1 space-y-1 text-xs">
          {#each field.lines ?? [] as line}
            <div class="break-all">{line}</div>
          {/each}
        </div>
      {:else}
        <div class={field.valueClass ?? ""}>{field.value ?? "-"}</div>
      {/if}
    </div>
  {/each}

  <KeyValueExpand
    title="Labels"
    entries={labels}
    emptyText={labelsEmptyText}
    contextKey={contextKey}
    variant="card"
  />

  <KeyValueExpand
    title="Annotations"
    entries={annotations}
    emptyText={annotationsEmptyText}
    contextKey={contextKey}
    variant="card"
  />
</div>
