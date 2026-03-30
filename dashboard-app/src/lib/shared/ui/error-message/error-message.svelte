<script lang="ts">
  export let error: string;
  export let clearMessages: (() => void) | null = null;
</script>

<div
  class="bg-red-100 border border-red-400 text-sm text-red-700 px-4 py-3 rounded mb-6"
>
  <div class="flex justify-between items-center">
    <span>{error}</span>
    {#if clearMessages}
    <button
      onclick={clearMessages}
      class="text-red-700 hover:text-red-900 text-xl">×</button
    >
    {/if}
  </div>
</div>
