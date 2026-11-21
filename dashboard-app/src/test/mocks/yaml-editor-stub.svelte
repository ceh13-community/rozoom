<script lang="ts">
  // Stands in for the CodeMirror YAML editor in component tests: a textarea with the same
  // value and onChange, so a test can type an edit.
  let {
    value = "",
    readonly = false,
    onChange,
  }: { value?: string; readonly?: boolean; onChange?: (next: string) => void } = $props();
</script>

<textarea
  aria-label="YAML editor"
  {value}
  {readonly}
  oninput={(event) => onChange?.((event.currentTarget as HTMLTextAreaElement).value)}
></textarea>
