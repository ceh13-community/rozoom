<script lang="ts">
  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<div class="px-4 py-6 text-sm text-muted-foreground">
  {message}
</div>
