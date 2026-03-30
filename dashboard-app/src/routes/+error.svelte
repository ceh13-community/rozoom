<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
</script>

<main class="flex flex-col h-screen bg-background text-foreground">
  <div class="m-auto max-w-md text-center px-6">
    <div class="text-6xl font-bold text-muted-foreground/30 mb-4">{page.status}</div>
    <h1 class="text-xl font-semibold mb-2">Something went wrong</h1>
    <p class="text-sm text-muted-foreground mb-6">
      {page.error?.message || "An unexpected error occurred."}
    </p>
    <div class="flex items-center justify-center gap-3">
      <button
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
        onclick={() => goto('/dashboard')}
      >
        Go to Dashboard
      </button>
      <button
        class="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition"
        onclick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  </div>
</main>
