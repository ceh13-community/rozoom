<script lang="ts">
  const { ready, total } = $props();
</script>

<div
  class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm border-b-2 border-slate-200 dark:border-slate-600"
>
  <span class="font-medium text-slate-700 dark:text-slate-300">Nodes:</span>
  <span class="font-bold">{ready}/{total}</span>
</div>
<!-- <div class="flex border-b-2 gap-4 py-2">
  <div class="w-[40%] min-w-[130px] font-bold flex items-center gap-2">
    <Server class="w-4 h-4 text-gray-500" />
    Nodes
  </div>
  <div class="text-left w-[60%]">
    {ready}/{total}
  </div>
</div> -->
