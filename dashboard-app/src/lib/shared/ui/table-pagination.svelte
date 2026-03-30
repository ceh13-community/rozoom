<script lang="ts">
  import { Button } from "$shared/ui/button";

  interface Props {
    currentPage: number;
    totalPages: number;
    totalRows: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  }

  let { currentPage, totalPages, totalRows, pageSize, onPageChange, onPageSizeChange }: Props = $props();

  const startRow = $derived(currentPage * pageSize + 1);
  const endRow = $derived(Math.min((currentPage + 1) * pageSize, totalRows));

  const pageSizeOptions = [50, 100, 200, 500];

  function visiblePages(): number[] {
    const pages: number[] = [];
    const start = Math.max(0, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }
</script>

{#if totalPages > 1}
  <div class="flex items-center justify-between gap-4 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
    <div class="flex items-center gap-2">
      <span>{startRow}-{endRow} of {totalRows}</span>
      {#if onPageSizeChange}
        <select
          value={pageSize}
          onchange={(e) => onPageSizeChange?.(Number((e.currentTarget as HTMLSelectElement).value))}
          class="h-6 text-[10px] px-1 rounded border border-border bg-background text-foreground"
        >
          {#each pageSizeOptions as size}
            <option value={size}>{size} / page</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        class="h-6 w-6 p-0 text-[10px]"
        disabled={currentPage === 0}
        onclick={() => onPageChange(0)}
        aria-label="First page"
      >&#x21E4;</Button>
      <Button
        variant="outline"
        size="sm"
        class="h-6 w-6 p-0 text-[10px]"
        disabled={currentPage === 0}
        onclick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
      >&#x2039;</Button>

      {#each visiblePages() as page (page)}
        <Button
          variant={page === currentPage ? "default" : "outline"}
          size="sm"
          class="h-6 min-w-6 px-1.5 text-[10px]"
          onclick={() => onPageChange(page)}
        >{page + 1}</Button>
      {/each}

      <Button
        variant="outline"
        size="sm"
        class="h-6 w-6 p-0 text-[10px]"
        disabled={currentPage >= totalPages - 1}
        onclick={() => onPageChange(currentPage + 1)}
        aria-label="Next page"
      >&#x203A;</Button>
      <Button
        variant="outline"
        size="sm"
        class="h-6 w-6 p-0 text-[10px]"
        disabled={currentPage >= totalPages - 1}
        onclick={() => onPageChange(totalPages - 1)}
        aria-label="Last page"
      >&#x21E5;</Button>
    </div>
  </div>
{:else if totalRows > 0}
  <div class="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
    {totalRows} rows
  </div>
{/if}
