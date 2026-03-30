<script lang="ts">
  import {
    addHelmRepo,
    getHelmReleaseHistory,
    getHelmReleaseManifest,
    getHelmReleaseStatus,
    getHelmReleaseValues,
    installOrUpgradeHelmRelease,
    listHelmReleases,
    listHelmRepos,
    removeHelmRepo,
    rollbackHelmRelease,
    testHelmRelease,
    uninstallHelmRelease,
    type HelmReleaseHistoryEntry,
    type HelmListedRelease,
    type HelmListedRepo,
  } from "$shared/api/helm";
  import * as Alert from "$shared/ui/alert";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";
  import { Refresh } from "$shared/ui/icons";
  import * as Table from "$shared/ui/table";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { confirmAction } from "$shared/lib/confirm-action";
  import {
    markSectionRefreshed,
    shouldRefreshOnSectionEnter,
  } from "$shared/lib/section-enter-refresh";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  let releases = $state<HelmListedRelease[]>([]);
  let repos = $state<HelmListedRepo[]>([]);
  let isLoading = $state(false);
  let releaseError = $state<string | null>(null);
  let repoError = $state<string | null>(null);
  let actionInFlight = $state<string | null>(null);
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  let repoForm = $state({ name: "", url: "" });
  let installForm = $state({
    releaseName: "",
    chart: "",
    namespace: "default",
    createNamespace: true,
  });
  let selectedRelease = $state<{ releaseName: string; namespace: string } | null>(null);
  let rollbackRevision = $state("");
  let releaseStatusJson = $state<string | null>(null);
  let releaseHistory = $state<HelmReleaseHistoryEntry[]>([]);
  let releaseValues = $state<string | null>(null);
  let releaseManifest = $state<string | null>(null);
  let releaseTestLogs = $state<string | null>(null);

  function releaseActionKey(
    action: string,
    release: HelmListedRelease | { releaseName: string; namespace: string },
  ) {
    const name = "releaseName" in release ? release.releaseName : release.name;
    return `release:${action}:${release.namespace}:${name}`;
  }

  function clearInspector() {
    releaseStatusJson = null;
    releaseHistory = [];
    releaseValues = null;
    releaseManifest = null;
    releaseTestLogs = null;
  }

  const releaseStatusBadgeClass = {
    deployed: "bg-emerald-500",
    failed: "bg-rose-600",
    pending: "bg-amber-500",
    uninstalled: "bg-slate-500",
    uninstalling: "bg-amber-500",
    superseded: "bg-slate-500",
  } as const;

  function statusClass(status?: string) {
    const normalized = (status || "").toLowerCase();
    if (normalized.includes("deploy")) return releaseStatusBadgeClass.deployed;
    if (normalized.includes("fail")) return releaseStatusBadgeClass.failed;
    if (normalized.includes("pending")) return releaseStatusBadgeClass.pending;
    if (normalized.includes("uninstall")) return releaseStatusBadgeClass.uninstalling;
    if (normalized.includes("superseded")) return releaseStatusBadgeClass.superseded;
    return "bg-slate-500";
  }

    async function refreshAll() {
    if (!clusterId || isLoading) return;
    isLoading = true;
    releaseError = null;
    repoError = null;

    try {
      const [releaseResult, repoResult] = await Promise.all([
        listHelmReleases(clusterId),
        listHelmRepos(),
      ]);

        releases = releaseResult.releases;
        repos = repoResult.repos;
        releaseError = releaseResult.error ?? null;
        repoError = repoResult.error ?? null;
        markSectionRefreshed(`helm:${clusterId}`);
      } finally {
        isLoading = false;
      }
    }

  async function onAddRepo() {
    if (actionInFlight) return;
    actionInFlight = "repo:add";
    actionNotice = null;
    try {
      const result = await addHelmRepo(repoForm.name, repoForm.url);
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Failed to add repository" };
        return;
      }
      repoForm = { name: "", url: "" };
      actionNotice = { type: "success", text: "Helm repository added." };
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  async function onRemoveRepo(name: string) {
    if (actionInFlight) return;
    const confirmed = await confirmAction(`Remove Helm repo "${name}"?`, "Confirm remove");
    if (!confirmed) return;
    actionInFlight = `repo:remove:${name}`;
    actionNotice = null;
    try {
      const result = await removeHelmRepo(name);
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Failed to remove repository" };
        return;
      }
      actionNotice = { type: "success", text: `Helm repository "${name}" removed.` };
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  async function onInstallOrUpgrade() {
    if (actionInFlight) return;
    actionInFlight = "release:install";
    actionNotice = null;
    try {
      const result = await installOrUpgradeHelmRelease(clusterId, installForm);
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Helm install/upgrade failed" };
        return;
      }
      actionNotice = {
        type: "success",
        text: `Release "${installForm.releaseName}" applied in namespace "${installForm.namespace}".`,
      };
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  async function onUninstall(release: HelmListedRelease) {
    if (actionInFlight) return;
    const confirmed = await confirmAction(
      `Uninstall release "${release.name}" from namespace "${release.namespace}"? This action cannot be undone.`,
      "Confirm uninstall",
    );
    if (!confirmed) {
      return;
    }
    actionInFlight = `release:uninstall:${release.namespace}:${release.name}`;
    actionNotice = null;
    try {
      const result = await uninstallHelmRelease(clusterId, {
        releaseName: release.name,
        namespace: release.namespace,
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Failed to uninstall release" };
        return;
      }
      actionNotice = {
        type: "success",
        text: `Release "${release.name}" was uninstalled from "${release.namespace}".`,
      };
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  async function onLoadStatus(release: HelmListedRelease) {
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("status", release);
    actionNotice = null;
    selectedRelease = { releaseName: release.name, namespace: release.namespace };
    clearInspector();
    try {
      const result = await getHelmReleaseStatus(clusterId, selectedRelease);
      if (result.error) {
        actionNotice = { type: "error", text: result.error };
        return;
      }
      releaseStatusJson = JSON.stringify(result.status ?? {}, null, 2);
    } finally {
      actionInFlight = null;
    }
  }

  async function onLoadHistory(release: HelmListedRelease) {
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("history", release);
    actionNotice = null;
    selectedRelease = { releaseName: release.name, namespace: release.namespace };
    clearInspector();
    try {
      const result = await getHelmReleaseHistory(clusterId, selectedRelease);
      if (result.error) {
        actionNotice = { type: "error", text: result.error };
        return;
      }
      releaseHistory = result.history;
    } finally {
      actionInFlight = null;
    }
  }

  async function onLoadValues(release: HelmListedRelease) {
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("values", release);
    actionNotice = null;
    selectedRelease = { releaseName: release.name, namespace: release.namespace };
    clearInspector();
    try {
      const result = await getHelmReleaseValues(clusterId, {
        ...selectedRelease,
        allValues: true,
      });
      if (result.error) {
        actionNotice = { type: "error", text: result.error };
        return;
      }
      releaseValues = result.values || "(empty)";
    } finally {
      actionInFlight = null;
    }
  }

  async function onLoadManifest(release: HelmListedRelease) {
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("manifest", release);
    actionNotice = null;
    selectedRelease = { releaseName: release.name, namespace: release.namespace };
    clearInspector();
    try {
      const result = await getHelmReleaseManifest(clusterId, selectedRelease);
      if (result.error) {
        actionNotice = { type: "error", text: result.error };
        return;
      }
      releaseManifest = result.manifest || "(empty)";
    } finally {
      actionInFlight = null;
    }
  }

  async function onTestRelease(release: HelmListedRelease) {
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("test", release);
    actionNotice = null;
    selectedRelease = { releaseName: release.name, namespace: release.namespace };
    clearInspector();
    try {
      const result = await testHelmRelease(clusterId, selectedRelease);
      releaseTestLogs = result.logs || "(no logs)";
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Helm test failed" };
        return;
      }
      actionNotice = { type: "success", text: `Helm test completed for "${release.name}".` };
    } finally {
      actionInFlight = null;
    }
  }

  async function onRollbackRelease() {
    if (!selectedRelease) {
      actionNotice = { type: "error", text: "Select a release action first (history/status/values)." };
      return;
    }
    if (!rollbackRevision.trim()) {
      actionNotice = { type: "error", text: "Revision is required for rollback." };
      return;
    }
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("rollback", selectedRelease);
    actionNotice = null;
    try {
      const result = await rollbackHelmRelease(clusterId, {
        ...selectedRelease,
        revision: rollbackRevision,
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Helm rollback failed" };
        return;
      }
      actionNotice = {
        type: "success",
        text: `Release "${selectedRelease.releaseName}" rolled back to revision ${rollbackRevision}.`,
      };
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

    $effect(() => {
      if (!clusterId || offline) return;
      if (!shouldRefreshOnSectionEnter(`helm:${clusterId}`, 30_000)) return;
      void refreshAll();
    });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Helm</h2>
      <Button variant="outline" onclick={refreshAll} loading={isLoading} disabled={offline}>
        <Refresh class="mr-2 h-4 w-4" />
        Refresh
        {#if isLoading}
          <LoadingDots />
        {/if}
      </Button>
    </div>
    <p class="text-sm text-muted-foreground">
      Manage Helm repositories and releases for this cluster.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
    {#if offline}
      <Alert.Root variant="destructive">
        <Alert.Title>Cluster offline</Alert.Title>
        <Alert.Description>Helm actions are disabled while cluster is offline.</Alert.Description>
      </Alert.Root>
    {/if}

    {#if releaseError}
      <Alert.Root variant="destructive">
        <Alert.Title>Failed to load releases</Alert.Title>
        <Alert.Description>{releaseError}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if repoError}
      <Alert.Root variant="destructive">
        <Alert.Title>Failed to load repositories</Alert.Title>
        <Alert.Description>{repoError}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if actionNotice?.type === "success"}
      <Alert.Root variant="default">
        <Alert.Title>Action completed</Alert.Title>
        <Alert.Description>{actionNotice.text}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if actionNotice?.type === "error"}
      <Alert.Root variant="destructive">
        <Alert.Title>Action failed</Alert.Title>
        <Alert.Description>{actionNotice.text}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Repositories">
        <p class="text-sm font-semibold text-foreground">{repos.length}</p>
        <p class="text-xs text-muted-foreground">
          {repoError ? "Repository catalog is degraded." : "Configured Helm repositories."}
        </p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Releases">
        <p class="text-sm font-semibold text-foreground">{releases.length}</p>
        <p class="text-xs text-muted-foreground">
          {selectedRelease
            ? `Inspector: ${selectedRelease.namespace}/${selectedRelease.releaseName}`
            : "No release selected in inspector."}
        </p>
      </DiagnosticSummaryCard>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-lg border border-border p-4">
        <p class="text-sm font-semibold">Add repository</p>
        <div class="mt-3 grid gap-2">
          <input
            class="h-8 rounded-md border border-border bg-background px-2 text-xs"
            placeholder="Repository name (e.g. bitnami)"
            aria-label="Repository name"
            bind:value={repoForm.name}
          />
          <input
            class="h-8 rounded-md border border-border bg-background px-2 text-xs"
            placeholder="Repository URL"
            aria-label="Repository URL"
            bind:value={repoForm.url}
          />
          <Button
            variant="outline"
            onclick={onAddRepo}
            disabled={offline || actionInFlight === "repo:add"}
          >
            Add repo
            {#if actionInFlight === "repo:add"}
              <LoadingDots />
            {/if}
          </Button>
        </div>
      </div>

      <div class="rounded-lg border border-border p-4">
        <p class="text-sm font-semibold">Install or upgrade release</p>
        <div class="mt-3 grid gap-2">
          <input
            class="h-8 rounded-md border border-border bg-background px-2 text-xs"
            placeholder="Release name"
            aria-label="Release name"
            bind:value={installForm.releaseName}
          />
          <input
            class="h-8 rounded-md border border-border bg-background px-2 text-xs"
            placeholder="Chart (e.g. bitnami/nginx)"
            aria-label="Chart"
            bind:value={installForm.chart}
          />
          <input
            class="h-8 rounded-md border border-border bg-background px-2 text-xs"
            placeholder="Namespace"
            aria-label="Release namespace"
            bind:value={installForm.namespace}
          />
          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" bind:checked={installForm.createNamespace} />
            Create namespace if missing
          </label>
          <Button
            variant="outline"
            onclick={onInstallOrUpgrade}
            disabled={offline || actionInFlight === "release:install"}
          >
            Install / upgrade
            {#if actionInFlight === "release:install"}
              <LoadingDots />
            {/if}
          </Button>
        </div>
      </div>
    </div>

    <TableSurface maxHeightClass="">
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>Repository</Table.TableHead>
            <Table.TableHead>URL</Table.TableHead>
            <Table.TableHead>Actions</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {#if repos.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={3} class="text-center">
                <TableEmptyState message="No Helm repositories configured." />
              </Table.TableCell>
            </Table.TableRow>
          {:else}
            {#each repos as repo}
              <Table.TableRow>
                <Table.TableCell class="font-medium">{repo.name}</Table.TableCell>
                <Table.TableCell class="text-xs text-muted-foreground">{repo.url}</Table.TableCell>
                <Table.TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() => onRemoveRepo(repo.name)}
                    disabled={offline || actionInFlight === `repo:remove:${repo.name}`}
                  >
                    Remove
                  </Button>
                </Table.TableCell>
              </Table.TableRow>
            {/each}
          {/if}
        </Table.TableBody>
      </Table.Table>
    </TableSurface>

    <TableSurface maxHeightClass="">
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>Release</Table.TableHead>
            <Table.TableHead>Namespace</Table.TableHead>
            <Table.TableHead>Chart</Table.TableHead>
            <Table.TableHead>Status</Table.TableHead>
            <Table.TableHead>Actions</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {#if releases.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={5} class="text-center">
                <TableEmptyState message="No Helm releases found." />
              </Table.TableCell>
            </Table.TableRow>
          {:else}
            {#each releases as release}
              <Table.TableRow>
                <Table.TableCell class="font-medium">{release.name}</Table.TableCell>
                <Table.TableCell>{release.namespace}</Table.TableCell>
                <Table.TableCell class="text-xs text-muted-foreground">{release.chart}</Table.TableCell>
                <Table.TableCell>
                  <Badge class={`text-white ${statusClass(release.status)}`}>
                    {release.status || "unknown"}
                  </Badge>
                </Table.TableCell>
                <Table.TableCell>
                  <div class="flex flex-wrap gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onLoadStatus(release)}
                      disabled={offline || actionInFlight === releaseActionKey("status", release)}
                    >
                      Status
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onLoadHistory(release)}
                      disabled={offline || actionInFlight === releaseActionKey("history", release)}
                    >
                      History
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onLoadValues(release)}
                      disabled={offline || actionInFlight === releaseActionKey("values", release)}
                    >
                      Values
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onLoadManifest(release)}
                      disabled={offline || actionInFlight === releaseActionKey("manifest", release)}
                    >
                      Manifest
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onTestRelease(release)}
                      disabled={offline || actionInFlight === releaseActionKey("test", release)}
                    >
                      Test
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onclick={() => onUninstall(release)}
                      disabled={offline || actionInFlight === releaseActionKey("uninstall", release)}
                    >
                      Uninstall
                    </Button>
                  </div>
                </Table.TableCell>
              </Table.TableRow>
            {/each}
          {/if}
        </Table.TableBody>
      </Table.Table>
    </TableSurface>

    <div class="rounded-lg border border-border p-4">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm font-semibold">Release inspector</p>
        {#if selectedRelease}
          <Badge class="bg-slate-500 text-white">{selectedRelease.namespace}/{selectedRelease.releaseName}</Badge>
        {/if}
      </div>
      <div class="mt-3 flex flex-wrap items-end gap-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-muted-foreground" for="rollback-revision">Rollback revision</label>
          <input
            id="rollback-revision"
            class="h-8 rounded-md border border-border bg-background px-2 text-xs"
            placeholder="e.g. 3"
            bind:value={rollbackRevision}
          />
        </div>
        <Button
          variant="outline"
          onclick={onRollbackRelease}
          disabled={offline || actionInFlight === releaseActionKey("rollback", selectedRelease ?? { releaseName: "", namespace: "" })}
        >
          Rollback
        </Button>
      </div>
      {#if releaseHistory.length > 0}
        <div class="mt-3 overflow-x-auto">
          <TableSurface maxHeightClass="max-h-80">
            <Table.Table>
              <Table.TableHeader>
                <Table.TableRow>
                  <Table.TableHead>Revision</Table.TableHead>
                  <Table.TableHead>Status</Table.TableHead>
                  <Table.TableHead>Updated</Table.TableHead>
                  <Table.TableHead>Description</Table.TableHead>
                </Table.TableRow>
              </Table.TableHeader>
              <Table.TableBody>
                {#each releaseHistory as entry}
                  <Table.TableRow>
                    <Table.TableCell>{entry.revision}</Table.TableCell>
                    <Table.TableCell>{entry.status ?? "-"}</Table.TableCell>
                    <Table.TableCell>{entry.updated ?? "-"}</Table.TableCell>
                    <Table.TableCell>{entry.description ?? "-"}</Table.TableCell>
                  </Table.TableRow>
                {/each}
              </Table.TableBody>
            </Table.Table>
          </TableSurface>
        </div>
      {/if}
      {#if releaseStatusJson}
        <pre class="mt-3 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseStatusJson}</pre>
      {/if}
      {#if releaseValues}
        <pre class="mt-3 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseValues}</pre>
      {/if}
      {#if releaseManifest}
        <pre class="mt-3 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseManifest}</pre>
      {/if}
      {#if releaseTestLogs}
        <pre class="mt-3 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseTestLogs}</pre>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
