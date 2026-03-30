<script lang="ts">
  export let success: string;
  export let clearMessages: (() => void) | null = null;
</script>

<div
  class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6"
>
  <div class="flex justify-between items-center">
    <span>{success}</span>
    {#if clearMessages}
    <button
      onclick={clearMessages}
      class="text-green-700 hover:text-green-900 text-xl">×</button
    >
    {/if}
  </div>
</div>
