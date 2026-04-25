<script lang="ts">
  interface Props {
    count?: number;
    class?: string;
  }

  let { count = 3, class: className = "" }: Props = $props();
  const dots = $derived(Array.from({ length: Math.max(1, count) }, (_, i) => i));
</script>

<span class={`loading-dots ${className}`.trim()} aria-hidden="true">
  {#each dots as dot (dot)}
    <span class="loading-dot" style={`animation-delay: ${dot * 0.16}s`}>.</span>
  {/each}
</span>
