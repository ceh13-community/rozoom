<script lang="ts">
  import { Button } from "$shared/ui/button";

  const { getCanNextPage, getCanPreviousPage, nextPage, previousPage } = $props();
</script>

<div class="flex items-center justify-end space-x-2 py-4">
  <Button variant="outline" size="sm" onclick={() => previousPage()} disabled={!getCanPreviousPage}>
    Previous
  </Button>
  <Button variant="outline" size="sm" onclick={() => nextPage()} disabled={!getCanNextPage}
    >Next</Button
  >
</div>
