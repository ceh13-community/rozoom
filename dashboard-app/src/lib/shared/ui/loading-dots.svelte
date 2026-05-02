<script lang="ts">
  interface Props {
    count?: number;
    class?: string;
  }

  let { count = 3, class: className = "" }: Props = $props();
  const dots = $derived(Array.from({ length: Math.max(1, count) }, (_, i) => i));
</script>

<span class={`loading-dots ${className}`.trim()} aria-hidden="true">
  {#each dots as dot}
    <span class="loading-dot" style={`animation-delay: ${dot * 0.16}s`}>.</span>
  {/each}
</span>

<style>
  .loading-dots {
    display: inline-flex;
    letter-spacing: 0.06em;
  }

  .loading-dot {
    opacity: 0.25;
    animation: dot-pulse 1s ease-in-out infinite;
  }

  @keyframes dot-pulse {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }
</style>
