<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import {
    startYamlBackup,
    refreshYamlBackupList,
    removeYamlBackup,
    startYamlRestore,
    yamlBackupProgress,
    yamlRestoreProgress,
    yamlBackupSnapshots,
    type YamlBackupSnapshot,
    type YamlBackupScope,
  } from "$features/yaml-backup";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
  import { toast } from "svelte-sonner";

  interface Props {
    clusterId: string;
    clusterName?: string;
  }

  const { clusterId, clusterName = "cluster" }: Props = $props();

  let activeTab = $state<"export" | "backups" | "restore">("export");
  let scope = $state<YamlBackupScope>("full-cluster");
  let includeSecrets = $state(false);
  let availableNamespaces = $state<string[]>([]);
  let selectedNamespaces = $state<string[]>([]);
  let isLoadingNamespaces = $state(false);
  let isExporting = $state(false);
  let restoreTarget = $state<YamlBackupSnapshot | null>(null);
  let restoreSelectedNs = $state<string[]>([]);
  let restoreScope = $state<"full" | "selected">("full");
  let isDryRun = $state(true);
  let isRestoring = $state(false);
  let confirmDelete = $state<string | null>(null);

  async function loadNamespaces() {
    isLoadingNamespaces = true;
    try {
      const result = await kubectlRawFront(
        "get namespaces -o jsonpath={.items[*].metadata.name} --request-timeout=10s",
        { clusterId },
      );
      if (result.output.trim()) {
        availableNamespaces = result.output.trim().split(/\s+/).filter(Boolean);
      }
    } catch {
      availableNamespaces = [];
    } finally {
      isLoadingNamespaces = false;
    }
  }

  async function handleExport() {
    if (includeSecrets) {
      const ok = window.confirm(
        "Secrets will be exported in plaintext (base64 is not encryption) and written " +
          "to your Downloads folder.\n\n" +
          "Make sure the destination is not synced to a public drive, email, or shared " +
          "workspace. Delete the backup when no longer needed.\n\n" +
          "Continue?",
      );
      if (!ok) return;
    }
    isExporting = true;
    try {
      const snapshot = await startYamlBackup({
        clusterId,
        clusterName,
        scope,
        namespaces: scope === "selected-namespaces" ? selectedNamespaces : undefined,
        includeSecrets,
      });
      toast.success("Backup completed", {
        description: `${snapshot.metadata.files.length} files saved to ~/Downloads/${snapshot.path}`,
      });
      activeTab = "backups";
    } catch (err) {
      toast.error("Backup failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      isExporting = false;
    }
  }

  async function handleDelete(snapshot: YamlBackupSnapshot) {
    try {
      await removeYamlBackup(snapshot);
      toast.success("Backup deleted");
      confirmDelete = null;
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function openRestore(snapshot: YamlBackupSnapshot) {
    restoreTarget = snapshot;
    restoreSelectedNs = [];
    restoreScope = "full";
    isDryRun = true;
    isRestoring = false;
    activeTab = "restore";
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    isRestoring = true;
    try {
      const result = await startYamlRestore(clusterId, restoreTarget, {
        selectedNamespaces: restoreScope === "selected" ? restoreSelectedNs : undefined,
        dryRun: isDryRun,
      });
      if (result.errors.length > 0) {
        toast.warning(
          isDryRun ? "Dry run completed with errors" : "Restore completed with errors",
          {
            description: `${result.applied.length} applied, ${result.errors.length} errors`,
          },
        );
      } else {
        toast.success(isDryRun ? "Dry run successful" : "Restore completed", {
          description: `${result.applied.length} resources applied`,
        });
      }
    } catch (err) {
      toast.error("Restore failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      isRestoring = false;
    }
  }

  function toggleNamespace(ns: string) {
    if (selectedNamespaces.includes(ns)) {
      selectedNamespaces = selectedNamespaces.filter((n) => n !== ns);
    } else {
      selectedNamespaces = [...selectedNamespaces, ns];
    }
  }

  function toggleRestoreNs(ns: string) {
    if (restoreSelectedNs.includes(ns)) {
      restoreSelectedNs = restoreSelectedNs.filter((n) => n !== ns);
    } else {
      restoreSelectedNs = [...restoreSelectedNs, ns];
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  onMount(() => {
    void loadNamespaces();
    void refreshYamlBackupList(clusterName);
  });
</script>

<div class="space-y-4">
  <div class="flex items-center gap-2 border-b border-border pb-2">
    <h3 class="text-sm font-semibold">Local YAML Backup</h3>
    <div class="ml-auto flex gap-1">
      {#each ["export", "backups", "restore"] as tab}
        <button
          class="rounded px-3 py-1 text-xs font-medium transition {activeTab === tab
            ? 'bg-sky-600 text-white'
            : 'text-muted-foreground hover:bg-muted'}"
          onclick={() => (activeTab = tab as "export" | "backups" | "restore")}
        >
          {tab === "export" ? "Export" : tab === "backups" ? "Backups" : "Restore"}
        </button>
      {/each}
    </div>
  </div>

  {#if activeTab === "export"}
    <div class="space-y-3">
      <div class="rounded-lg border border-border bg-card p-4 space-y-3">
        <div class="text-xs text-muted-foreground">
          Export cluster resources as YAML manifests to <code class="bg-muted px-1 rounded"
            >~/Downloads/rozoom/backup/</code
          >
        </div>

        <div class="flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" bind:group={scope} value="full-cluster" class="accent-sky-500" />
            Full cluster
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              bind:group={scope}
              value="selected-namespaces"
              class="accent-sky-500"
            />
            Selected namespaces
          </label>
        </div>

        {#if scope === "selected-namespaces"}
          <div
            class="max-h-40 overflow-y-auto rounded border border-border bg-background p-2 space-y-1"
          >
            {#if isLoadingNamespaces}
              <div class="text-xs text-muted-foreground">Loading namespaces<LoadingDots /></div>
            {:else if availableNamespaces.length === 0}
              <div class="text-xs text-muted-foreground">No namespaces found</div>
            {:else}
              {#each availableNamespaces as ns}
                <label
                  class="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedNamespaces.includes(ns)}
                    onchange={() => toggleNamespace(ns)}
                    class="accent-sky-500"
                  />
                  {ns}
                </label>
              {/each}
            {/if}
          </div>
        {/if}

        <div class="rounded border border-border bg-background p-2 space-y-1">
          <label class="flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" bind:checked={includeSecrets} class="mt-0.5 accent-amber-500" />
            <span>
              <span class="font-medium">Include Secrets</span>
              <span class="block text-[11px] text-muted-foreground">
                Off by default. Secrets are exported as plaintext YAML (base64 is not encryption).
              </span>
            </span>
          </label>
          {#if includeSecrets}
            <div
              class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300"
            >
              Secrets will be written to <code class="font-mono">~/Downloads</code> in plaintext. Do
              not sync this folder to a public drive or share the backup without encrypting it first.
            </div>
          {/if}
        </div>

        <Button
          variant="default"
          size="sm"
          disabled={isExporting ||
            (scope === "selected-namespaces" && selectedNamespaces.length === 0)}
          onclick={handleExport}
        >
          {#if isExporting}
            Exporting<LoadingDots />
          {:else}
            Export YAML Backup
          {/if}
        </Button>
      </div>

      {#if $yamlBackupProgress && isExporting}
        <div class="rounded-lg border border-border bg-card p-4 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              {$yamlBackupProgress.currentResource || $yamlBackupProgress.phase}
            </span>
            <span class="font-mono">
              {$yamlBackupProgress.completedResources}/{$yamlBackupProgress.totalResources}
            </span>
          </div>
          <div class="h-2 overflow-hidden rounded bg-muted">
            <div
              class="h-full bg-sky-500 transition-all"
              style="width: {$yamlBackupProgress.totalResources > 0
                ? ($yamlBackupProgress.completedResources / $yamlBackupProgress.totalResources) *
                  100
                : 0}%"
            ></div>
          </div>
          {#if $yamlBackupProgress.errors.length > 0}
            <div class="text-[11px] text-amber-600 dark:text-amber-400">
              {$yamlBackupProgress.errors.length} warning(s) - some resources may be inaccessible
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if activeTab === "backups"}
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="text-xs text-muted-foreground">Local backups in ~/Downloads/rozoom/backup/</div>
        <Button variant="ghost" size="sm" onclick={() => refreshYamlBackupList(clusterName)}>
          Refresh
        </Button>
      </div>

      {#if $yamlBackupSnapshots.length === 0}
        <div
          class="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground"
        >
          No local backups found. Use the Export tab to create one.
        </div>
      {:else}
        {#each $yamlBackupSnapshots as snapshot (snapshot.path)}
          <div class="rounded-lg border border-border bg-card p-3 space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">{formatDate(snapshot.timestamp)}</div>
                <div class="text-xs text-muted-foreground">
                  {snapshot.metadata.scope === "full-cluster"
                    ? "Full cluster"
                    : `${snapshot.metadata.namespaces.length} namespace(s)`}
                  - {snapshot.metadata.files.length} files
                  {#if snapshot.metadata.errors.length > 0}
                    - <span class="text-amber-500">{snapshot.metadata.errors.length} warnings</span>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <Button variant="outline" size="sm" onclick={() => openRestore(snapshot)}>
                  Restore
                </Button>
                {#if confirmDelete === snapshot.path}
                  <Button variant="destructive" size="sm" onclick={() => handleDelete(snapshot)}>
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onclick={() => (confirmDelete = null)}>
                    Cancel
                  </Button>
                {:else}
                  <Button variant="ghost" size="sm" onclick={() => (confirmDelete = snapshot.path)}>
                    Delete
                  </Button>
                {/if}
              </div>
            </div>
            <div class="flex flex-wrap gap-1">
              {#each snapshot.metadata.namespaces.slice(0, 10) as ns}
                <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{ns}</span>
              {/each}
              {#if snapshot.metadata.namespaces.length > 10}
                <span class="text-[10px] text-muted-foreground"
                  >+{snapshot.metadata.namespaces.length - 10} more</span
                >
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  {#if activeTab === "restore"}
    <div class="space-y-3">
      {#if !restoreTarget}
        <div
          class="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground"
        >
          Select a backup from the Backups tab to restore.
        </div>
      {:else}
        <div class="rounded-lg border border-border bg-card p-4 space-y-3">
          <div class="text-sm font-medium">
            Restore from {formatDate(restoreTarget.timestamp)}
          </div>
          <div class="text-xs text-muted-foreground">
            {restoreTarget.metadata.files.length} files,
            {restoreTarget.metadata.namespaces.length} namespace(s)
          </div>

          <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" bind:group={restoreScope} value="full" class="accent-sky-500" />
              Full restore
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="radio"
                bind:group={restoreScope}
                value="selected"
                class="accent-sky-500"
              />
              Selected namespaces
            </label>
          </div>

          {#if restoreScope === "selected"}
            <div
              class="max-h-40 overflow-y-auto rounded border border-border bg-background p-2 space-y-1"
            >
              {#each restoreTarget.metadata.namespaces as ns}
                <label
                  class="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={restoreSelectedNs.includes(ns)}
                    onchange={() => toggleRestoreNs(ns)}
                    class="accent-sky-500"
                  />
                  {ns}
                </label>
              {/each}
            </div>
          {/if}

          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={isDryRun} class="accent-sky-500" />
            Dry run (preview only, no changes applied)
          </label>

          <div class="flex items-center gap-2">
            <Button
              variant={isDryRun ? "outline" : "destructive"}
              size="sm"
              disabled={isRestoring ||
                (restoreScope === "selected" && restoreSelectedNs.length === 0)}
              onclick={handleRestore}
            >
              {#if isRestoring}
                {isDryRun ? "Running preview" : "Restoring"}<LoadingDots />
              {:else}
                {isDryRun ? "Preview restore" : "Apply restore"}
              {/if}
            </Button>
            <Button variant="ghost" size="sm" onclick={() => (restoreTarget = null)}>Cancel</Button>
          </div>
        </div>

        {#if $yamlRestoreProgress && isRestoring}
          <div class="rounded-lg border border-border bg-card p-4 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{$yamlRestoreProgress.currentFile}</span>
              <span class="font-mono">
                {$yamlRestoreProgress.completedFiles}/{$yamlRestoreProgress.totalFiles}
              </span>
            </div>
            <div class="h-2 overflow-hidden rounded bg-muted">
              <div
                class="h-full bg-emerald-500 transition-all"
                style="width: {$yamlRestoreProgress.totalFiles > 0
                  ? ($yamlRestoreProgress.completedFiles / $yamlRestoreProgress.totalFiles) * 100
                  : 0}%"
              ></div>
            </div>
          </div>
        {/if}

        {#if $yamlRestoreProgress && !isRestoring && $yamlRestoreProgress.phase !== "applying"}
          <div class="rounded-lg border border-border bg-card p-4 space-y-2">
            <div class="text-sm font-medium">
              {$yamlRestoreProgress.phase === "done"
                ? "Restore completed"
                : "Restore finished with errors"}
            </div>
            {#if $yamlRestoreProgress.applied.length > 0}
              <div class="text-xs text-emerald-600 dark:text-emerald-400">
                Applied: {$yamlRestoreProgress.applied.length} file(s)
              </div>
            {/if}
            {#if $yamlRestoreProgress.errors.length > 0}
              <div class="space-y-1">
                {#each $yamlRestoreProgress.errors.slice(0, 5) as error}
                  <div class="text-[11px] text-rose-600 dark:text-rose-400 break-all">{error}</div>
                {/each}
                {#if $yamlRestoreProgress.errors.length > 5}
                  <div class="text-[11px] text-muted-foreground">
                    +{$yamlRestoreProgress.errors.length - 5} more errors
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
