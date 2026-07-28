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
    showHelmChartValues,
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
  import * as Popover from "$shared/ui/popover";
  import { Refresh } from "$shared/ui/icons";
  import * as Table from "$shared/ui/table";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import YamlEditor from "$shared/ui/yaml-editor.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { humanizeHelmError } from "$features/helm-ux/model/humanize";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";
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
  let releaseFilter = $state("");
  let repoFilter = $state("");
  let isLoading = $state(false);

  const filteredReleases = $derived.by(() => {
    const q = releaseFilter.trim().toLowerCase();
    if (!q) return releases;
    return releases.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.namespace.toLowerCase().includes(q) ||
        (r.chart ?? "").toLowerCase().includes(q) ||
        (r.status ?? "").toLowerCase().includes(q),
    );
  });

  const filteredRepos = $derived.by(() => {
    const q = repoFilter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.url ?? "").toLowerCase().includes(q),
    );
  });
  let releaseError = $state<string | null>(null);
  let repoError = $state<string | null>(null);
  let actionInFlight = $state<string | null>(null);
  let actionNotice = $state<{ type: "success" | "error"; title?: string; text: string } | null>(
    null,
  );
  // Shared console for all helm actions. actionInFlight already serializes
  // to one action at a time, so a single session is safe.
  const helmSession = createConsoleSession();
  let helmSessionLabel = $state("Helm");
  let helmConsoleEl = $state<HTMLDivElement | null>(null);
  let repoForm = $state({ name: "", url: "" });
  let installForm = $state({
    releaseName: "",
    chart: "",
    namespace: "default",
    createNamespace: true,
  });
  const isUpgrade = $derived(
    installForm.releaseName.trim() !== "" &&
      releases.some(
        (r) =>
          r.name === installForm.releaseName.trim() && r.namespace === installForm.namespace.trim(),
      ),
  );
  let installVersion = $state("");
  let installValuesYaml = $state<string | null>(null);
  let installValuesForChart = $state<string | null>(null);
  let installValuesDialog = $state<{
    yaml: string;
    defaults: string;
    loadingDefaults: boolean;
    error: string | null;
  } | null>(null);
  let dryRunOutput = $state<string | null>(null);
  let diffView = $state<{ current: string; next: string } | null>(null);
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

  const releaseStatusLabels: Record<string, string> = {
    deployed: "Deployed",
    failed: "Failed",
    "pending-upgrade": "Pending upgrade",
    "pending-install": "Pending install",
    "pending-rollback": "Pending rollback",
    uninstalled: "Uninstalled",
    uninstalling: "Uninstalling",
    superseded: "Superseded",
  };

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

  async function openInstallValuesEditor() {
    if (!installForm.chart.trim()) {
      actionNotice = { type: "error", text: "Enter a chart name first (e.g. bitnami/nginx)." };
      return;
    }
    installValuesDialog = {
      yaml: installValuesYaml ?? "",
      defaults: "",
      loadingDefaults: true,
      error: null,
    };
    const result = await showHelmChartValues(
      installForm.chart.trim(),
      installVersion.trim() || undefined,
    );
    if (!installValuesDialog) return;
    if (result.error) {
      installValuesDialog = {
        ...installValuesDialog,
        loadingDefaults: false,
        error: result.error,
        defaults: "",
        yaml: installValuesYaml ?? "# Could not load chart defaults. Enter your values manually.\n",
      };
      return;
    }
    const defaults = result.values || "# Chart has no default values.\n";
    installValuesDialog = {
      ...installValuesDialog,
      loadingDefaults: false,
      defaults,
      yaml: installValuesDialog.yaml || defaults,
      error: null,
    };
  }

  async function onAddRepo() {
    if (actionInFlight) return;
    if (!repoForm.name.trim() || !repoForm.url.trim()) {
      actionNotice = { type: "error", text: "Repository name and URL are required." };
      return;
    }
    actionInFlight = "repo:add";
    actionNotice = null;
    try {
      const result = await addHelmRepo(repoForm.name, repoForm.url);
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Failed to add repository" };
        return;
      }
      repoForm = { name: "", url: "" };
      actionNotice = { type: "success", title: "Repository added", text: "Helm repository added." };
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
      actionNotice = {
        type: "success",
        title: "Repository removed",
        text: `Helm repository "${name}" removed.`,
      };
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  async function onInstallOrUpgrade() {
    if (actionInFlight) return;
    if (!installForm.releaseName.trim() || !installForm.chart.trim()) {
      actionNotice = { type: "error", text: "Release name and chart are required." };
      return;
    }
    const existing = releases.find(
      (r) =>
        r.name === installForm.releaseName.trim() && r.namespace === installForm.namespace.trim(),
    );
    if (existing) {
      const confirmed = await confirmAction(
        `Release "${existing.name}" already exists in "${existing.namespace}" ` +
          `(chart: ${existing.chart}, status: ${existing.status ?? "unknown"}).\n\n` +
          `Proceeding will run helm upgrade and may replace workloads. ` +
          `Use Preview (dry-run) first if you want to see what changes.\n\nContinue?`,
        "Confirm upgrade",
      );
      if (!confirmed) return;
    }
    actionInFlight = "release:install";
    actionNotice = null;
    dryRunOutput = null;
    helmSessionLabel = `Helm upgrade --install ${installForm.releaseName}`;
    helmSession.start();
    scrollToConsole();
    try {
      const result = await installOrUpgradeHelmRelease(clusterId, {
        ...installForm,
        chartVersion: installVersion.trim() || undefined,
        valuesYaml: installValuesYaml ?? undefined,
        onOutput: (chunk) => helmSession.append(chunk),
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Helm install/upgrade failed" };
        helmSession.fail();
        return;
      }
      actionNotice = {
        type: "success",
        title: isUpgrade ? "Release upgraded" : "Release installed",
        text: `Release "${installForm.releaseName}" applied in namespace "${installForm.namespace}".`,
      };
      installForm = { releaseName: "", chart: "", namespace: "default", createNamespace: true };
      installVersion = "";
      installValuesYaml = null;
      installValuesForChart = null;
      helmSession.succeed();
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  async function onDiffAgainstCurrent() {
    if (actionInFlight) return;
    const target = releases.find(
      (r) =>
        r.name === installForm.releaseName.trim() && r.namespace === installForm.namespace.trim(),
    );
    if (!target) {
      actionNotice = {
        type: "error",
        text: "Release with this name+namespace is not installed yet; use Preview instead.",
      };
      return;
    }
    actionInFlight = "release:diff";
    actionNotice = null;
    dryRunOutput = null;
    diffView = null;
    try {
      const [currentResult, nextResult] = await Promise.all([
        getHelmReleaseManifest(clusterId, {
          releaseName: target.name,
          namespace: target.namespace,
        }),
        installOrUpgradeHelmRelease(clusterId, {
          ...installForm,
          chartVersion: installVersion.trim() || undefined,
          valuesYaml: installValuesYaml ?? undefined,
          dryRun: true,
        }),
      ]);
      if (currentResult.error) {
        actionNotice = { type: "error", text: currentResult.error };
        return;
      }
      if (!nextResult.success) {
        actionNotice = { type: "error", text: nextResult.error ?? "Dry-run failed" };
        return;
      }
      diffView = {
        current: currentResult.manifest?.trim() || "(empty)",
        next: nextResult.output?.trim() || "(empty)",
      };
      actionNotice = {
        type: "success",
        title: "Diff ready",
        text: "Diff prepared. Review current vs proposed manifest below, then Apply.",
      };
    } finally {
      actionInFlight = null;
    }
  }

  async function onDryRun() {
    if (actionInFlight) return;
    actionInFlight = "release:dry-run";
    actionNotice = null;
    dryRunOutput = null;
    try {
      const result = await installOrUpgradeHelmRelease(clusterId, {
        ...installForm,
        chartVersion: installVersion.trim() || undefined,
        valuesYaml: installValuesYaml ?? undefined,
        dryRun: true,
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Dry-run failed" };
        return;
      }
      dryRunOutput = result.output?.trim() || "(empty rendered template)";
      actionNotice = {
        type: "success",
        title: "Preview ready",
        text: `Dry-run completed. Review the rendered template below, then Apply to install.`,
      };
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
    helmSessionLabel = `Helm uninstall ${release.name}`;
    helmSession.start();
    scrollToConsole();
    try {
      const result = await uninstallHelmRelease(clusterId, {
        releaseName: release.name,
        namespace: release.namespace,
        onOutput: (chunk) => helmSession.append(chunk),
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Failed to uninstall release" };
        helmSession.fail();
        return;
      }
      actionNotice = {
        type: "success",
        title: "Release uninstalled",
        text: `Release "${release.name}" was uninstalled from "${release.namespace}".`,
      };
      helmSession.succeed();
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
    helmSessionLabel = `Helm test ${release.name}`;
    helmSession.start();
    scrollToConsole();
    try {
      const result = await testHelmRelease(clusterId, {
        ...selectedRelease,
        onOutput: (chunk) => helmSession.append(chunk),
      });
      releaseTestLogs = result.logs || "(no logs)";
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Helm test failed" };
        helmSession.fail();
        return;
      }
      actionNotice = {
        type: "success",
        title: "Helm test passed",
        text: `Helm test completed for "${release.name}".`,
      };
      helmSession.succeed();
    } finally {
      actionInFlight = null;
    }
  }

  async function onRollbackRelease(revision?: string) {
    if (!selectedRelease) {
      actionNotice = {
        type: "error",
        text: "Select a release action first (history/status/values).",
      };
      return;
    }
    const rev = (revision ?? rollbackRevision).toString().trim();
    if (!rev) {
      actionNotice = { type: "error", text: "Revision is required for rollback." };
      return;
    }
    if (!/^\d+$/.test(rev)) {
      actionNotice = { type: "error", text: "Revision must be a positive integer (e.g. 3)." };
      return;
    }
    const confirmed = await confirmAction(
      `Rollback "${selectedRelease.releaseName}" in namespace "${selectedRelease.namespace}" ` +
        `to revision ${rev}?\n\n` +
        `Helm will re-apply the manifests from that revision. Running workloads may restart.`,
      "Confirm rollback",
    );
    if (!confirmed) return;
    if (actionInFlight) return;
    actionInFlight = releaseActionKey("rollback", selectedRelease);
    actionNotice = null;
    helmSessionLabel = `Helm rollback ${selectedRelease.releaseName} -> rev ${rev}`;
    helmSession.start();
    scrollToConsole();
    try {
      const result = await rollbackHelmRelease(clusterId, {
        ...selectedRelease,
        revision: rev,
        onOutput: (chunk) => helmSession.append(chunk),
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Helm rollback failed" };
        helmSession.fail();
        return;
      }
      actionNotice = {
        type: "success",
        title: "Release rolled back",
        text: `Release "${selectedRelease.releaseName}" rolled back to revision ${rev}.`,
      };
      helmSession.succeed();
      rollbackRevision = "";
      await refreshAll();
    } finally {
      actionInFlight = null;
    }
  }

  function scrollToConsole() {
    helmConsoleEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function computeLineDiff(
    before: string,
    after: string,
  ): Array<{ type: "same" | "removed" | "added"; text: string }> {
    const a = before.split("\n").slice(0, 300);
    const b = after.split("\n").slice(0, 300);
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
        }
      }
    }
    const result: Array<{ type: "same" | "removed" | "added"; text: string }> = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        result.unshift({ type: "same", text: a[i - 1] ?? "" });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
        result.unshift({ type: "added", text: b[j - 1] ?? "" });
        j--;
      } else {
        result.unshift({ type: "removed", text: a[i - 1] ?? "" });
        i--;
      }
    }
    return result;
  }

  $effect(() => {
    if (!clusterId || offline) return;
    // Always load when state is empty (e.g. after navigation back resets local state),
    // otherwise respect the 30s cache to avoid redundant fetches.
    if (releases.length > 0 && !shouldRefreshOnSectionEnter(`helm:${clusterId}`, 30_000)) return;
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
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>Failed to load releases</Alert.Title>
            <Alert.Description>{releaseError}</Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (releaseError = null)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    {#if repoError}
      <Alert.Root variant="destructive">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>Failed to load repositories</Alert.Title>
            <Alert.Description>{repoError}</Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (repoError = null)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    {#if actionNotice?.type === "success"}
      <Alert.Root variant="default">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>{actionNotice.title ?? "Done"}</Alert.Title>
            <Alert.Description>{actionNotice.text}</Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (actionNotice = null)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    {#if actionNotice?.type === "error"}
      {@const humanized = humanizeHelmError(actionNotice.text)}
      <Alert.Root variant="destructive">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>{humanized.title}</Alert.Title>
            <Alert.Description>
              {#if humanized.hint}
                <p class="mb-1">{humanized.hint}</p>
              {/if}
              <pre class="whitespace-pre-wrap text-[11px] opacity-80">{actionNotice.text}</pre>
            </Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (actionNotice = null)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    <div bind:this={helmConsoleEl}>
      <CommandConsole session={helmSession} label={helmSessionLabel} />
    </div>

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
            ? `Inspecting: ${selectedRelease.namespace}/${selectedRelease.releaseName}`
            : "Use History / Status on a row to inspect."}
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
            disabled={offline || Boolean(actionInFlight)}
          >
            Add repo
            {#if actionInFlight === "repo:add"}
              <LoadingDots />
            {/if}
          </Button>
        </div>
      </div>

      <div class="rounded-lg border border-border p-4">
        <p class="text-sm font-semibold">{isUpgrade ? "Upgrade release" : "Install release"}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Runs <span class="font-mono text-foreground">helm upgrade --install</span> — idempotent. Add
          the chart's repo on the left before installing.
        </p>
        {#if isUpgrade}
          <p
            class="mt-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300"
          >
            Release <span class="font-semibold">{installForm.releaseName.trim()}</span> already
            exists in namespace <span class="font-semibold">{installForm.namespace.trim()}</span> - this
            will upgrade it.
          </p>
        {/if}
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
            placeholder="Version (optional, e.g. 1.2.3)"
            aria-label="Chart version"
            bind:value={installVersion}
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
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onclick={() => void openInstallValuesEditor()}
              disabled={offline || Boolean(actionInFlight)}
              title="Edit values.yaml before installing — prefilled from helm show values"
            >
              Edit values
            </Button>
            {#if installValuesYaml}
              <div class="flex flex-col gap-0.5">
                <span class="flex items-center gap-1 text-[11px] text-emerald-400">
                  Custom values set ✓
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground"
                    onclick={() => {
                      installValuesYaml = null;
                      installValuesForChart = null;
                    }}
                    title="Clear custom values and use chart defaults">✕</button
                  >
                </span>
                {#if installValuesForChart && installValuesForChart !== installForm.chart.trim()}
                  <span class="text-[10px] text-amber-400">
                    Values set for "{installValuesForChart}" - re-open editor to refresh defaults
                  </span>
                {/if}
              </div>
            {/if}
            <Button
              variant="outline"
              size="sm"
              onclick={onDryRun}
              disabled={offline || Boolean(actionInFlight)}
              title="Render the chart with these values without touching the cluster (helm --dry-run)"
            >
              Preview (dry-run)
              {#if actionInFlight === "release:dry-run"}
                <LoadingDots />
              {/if}
            </Button>
            {#if isUpgrade}
              <Button
                variant="outline"
                size="sm"
                onclick={onDiffAgainstCurrent}
                disabled={offline || Boolean(actionInFlight)}
                title="Compare current live manifest to the dry-run output for the new values"
              >
                Diff vs current
                {#if actionInFlight === "release:diff"}
                  <LoadingDots />
                {/if}
              </Button>
            {/if}
            <Button
              class="bg-emerald-600 text-white hover:bg-emerald-700"
              onclick={onInstallOrUpgrade}
              disabled={offline || Boolean(actionInFlight)}
              title={isUpgrade
                ? `Run helm upgrade for release "${installForm.releaseName.trim()}" in namespace "${installForm.namespace.trim()}"`
                : "Run helm upgrade --install to create the release"}
            >
              {isUpgrade ? "Upgrade" : "Install"}
              {#if actionInFlight === "release:install"}
                <LoadingDots />
              {/if}
            </Button>
          </div>
          {#if dryRunOutput}
            <div class="mt-2">
              <div class="mb-1 flex items-center justify-between">
                <p class="text-xs font-semibold text-muted-foreground">Dry-run output</p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="text-xs text-muted-foreground hover:text-foreground"
                    onclick={() => void navigator.clipboard.writeText(dryRunOutput ?? "")}
                    title="Copy to clipboard">Copy</button
                  >
                  <Button variant="ghost" size="sm" onclick={() => (dryRunOutput = null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
              <pre
                class="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-[11px] font-mono whitespace-pre-wrap">{dryRunOutput}</pre>
            </div>
          {/if}
          {#if diffView}
            {@const unifiedDiff = computeLineDiff(diffView.current, diffView.next)}
            <div class="mt-2">
              <div class="mb-1 flex items-center justify-between">
                <p class="text-xs font-semibold text-muted-foreground">
                  Manifest diff ·
                  <span class="text-rose-400">red = removed</span> ·
                  <span class="text-emerald-400">green = added</span>
                </p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="text-xs text-muted-foreground hover:text-foreground"
                    onclick={() =>
                      void navigator.clipboard.writeText(
                        `--- current\n${diffView?.current ?? ""}\n+++ next\n${diffView?.next ?? ""}`,
                      )}
                    title="Copy diff to clipboard">Copy</button
                  >
                  <Button variant="ghost" size="sm" onclick={() => (diffView = null)}
                    >Dismiss</Button
                  >
                </div>
              </div>
              <div
                class="max-h-80 overflow-auto rounded-md border border-border bg-muted font-mono text-[11px]"
              >
                {#each unifiedDiff as line}
                  <div
                    class="whitespace-pre px-3 py-0.5 {line.type === 'removed'
                      ? 'bg-rose-500/20 text-rose-300'
                      : line.type === 'added'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-muted-foreground'}"
                  >
                    {line.type === "removed"
                      ? "- "
                      : line.type === "added"
                        ? "+ "
                        : "  "}{line.text}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-semibold">Repositories ({filteredRepos.length}/{repos.length})</p>
      <input
        type="search"
        class="h-8 w-64 rounded-md border border-border bg-background px-2 text-xs"
        placeholder="Filter by name or URL"
        aria-label="Filter repositories"
        bind:value={repoFilter}
      />
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
          {#if isLoading && repos.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={3} class="text-center">
                <div
                  class="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
                >
                  <span>Loading repositories<LoadingDots /></span>
                </div>
              </Table.TableCell>
            </Table.TableRow>
          {:else if repos.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={3} class="text-center">
                <TableEmptyState
                  message="No Helm repositories configured. Add one above to install charts."
                />
              </Table.TableCell>
            </Table.TableRow>
          {:else if filteredRepos.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={3} class="text-center">
                <TableEmptyState
                  message={`No repositories match "${repoFilter}". Clear the filter to see all ${repos.length}.`}
                />
              </Table.TableCell>
            </Table.TableRow>
          {:else}
            {#each filteredRepos as repo}
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
                    {#if actionInFlight === `repo:remove:${repo.name}`}<LoadingDots
                      />{:else}Remove{/if}
                  </Button>
                </Table.TableCell>
              </Table.TableRow>
            {/each}
          {/if}
        </Table.TableBody>
      </Table.Table>
    </TableSurface>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p class="text-sm font-semibold">Releases ({filteredReleases.length}/{releases.length})</p>
        <p class="text-xs text-muted-foreground">
          Click History, Status, Values or Manifest to inspect a release below the table.
        </p>
      </div>
      <input
        type="search"
        class="h-8 w-72 rounded-md border border-border bg-background px-2 text-xs"
        placeholder="Filter by name, namespace, chart or status"
        aria-label="Filter releases"
        bind:value={releaseFilter}
      />
    </div>
    <TableSurface maxHeightClass="">
      <Table.Table class="table-fixed">
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead class="w-[22%]">Release</Table.TableHead>
            <Table.TableHead class="w-[16%]">Namespace</Table.TableHead>
            <Table.TableHead class="w-[22%]">Chart</Table.TableHead>
            <Table.TableHead class="w-[10%]">Status</Table.TableHead>
            <Table.TableHead class="w-[30%]">Actions</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {#if isLoading && releases.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={5} class="text-center">
                <div
                  class="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
                >
                  <span>Loading releases<LoadingDots /></span>
                </div>
              </Table.TableCell>
            </Table.TableRow>
          {:else if releases.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={5} class="text-center">
                <TableEmptyState
                  message="No Helm releases found. Install a chart via the form above or browse the Helm Catalog."
                />
              </Table.TableCell>
            </Table.TableRow>
          {:else if filteredReleases.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={5} class="text-center">
                <TableEmptyState
                  message={`No releases match "${releaseFilter}". Clear the filter to see all ${releases.length}.`}
                />
              </Table.TableCell>
            </Table.TableRow>
          {:else}
            {#each filteredReleases as release (release.namespace + ":" + release.name)}
              {@const popoverBusy = ["status", "values", "manifest", "test"].some(
                (k) => actionInFlight === releaseActionKey(k, release),
              )}
              <Table.TableRow>
                <Table.TableCell class="font-medium">
                  <div class="truncate" title={release.name}>{release.name}</div>
                </Table.TableCell>
                <Table.TableCell>
                  <div class="truncate" title={release.namespace}>{release.namespace}</div>
                </Table.TableCell>
                <Table.TableCell class="text-xs text-muted-foreground">
                  <div class="truncate" title={release.chart}>{release.chart}</div>
                </Table.TableCell>
                <Table.TableCell>
                  <Badge class={`text-white ${statusClass(release.status)}`}>
                    {releaseStatusLabels[(release.status ?? "").toLowerCase()] ??
                      release.status ??
                      "Unknown"}
                  </Badge>
                </Table.TableCell>
                <Table.TableCell class="w-fit min-w-[200px]">
                  <div class="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={() => onLoadHistory(release)}
                      disabled={offline || actionInFlight === releaseActionKey("history", release)}
                      title="Browse revision history and roll back"
                    >
                      {#if actionInFlight === releaseActionKey("history", release)}<LoadingDots
                        />{:else}History{/if}
                    </Button>
                    <Popover.Root>
                      <Popover.Trigger>
                        <Button
                          variant="outline"
                          size="sm"
                          title="More actions: Status, Values, Manifest, Test"
                          disabled={offline || popoverBusy}
                        >
                          {#if popoverBusy}<LoadingDots />{:else}···{/if}
                        </Button>
                      </Popover.Trigger>
                      <Popover.Content class="w-36 p-1" sideOffset={4}>
                        <div class="flex flex-col gap-0.5">
                          {#each [{ label: "Status", action: () => onLoadStatus(release), key: "status" }, { label: "Values", action: () => onLoadValues(release), key: "values" }, { label: "Manifest", action: () => onLoadManifest(release), key: "manifest" }, { label: "Test", action: () => onTestRelease(release), key: "test" }] as item (item.key)}
                            <button
                              type="button"
                              class="w-full rounded px-3 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                              onclick={item.action}
                              disabled={offline ||
                                actionInFlight === releaseActionKey(item.key, release)}
                            >
                              {#if actionInFlight === releaseActionKey(item.key, release)}<LoadingDots
                                />{:else}{item.label}{/if}
                            </button>
                          {/each}
                        </div>
                      </Popover.Content>
                    </Popover.Root>
                    <Button
                      variant="destructive"
                      size="sm"
                      onclick={() => onUninstall(release)}
                      disabled={offline ||
                        actionInFlight === releaseActionKey("uninstall", release)}
                    >
                      {#if actionInFlight === releaseActionKey("uninstall", release)}<LoadingDots
                        />{:else}Uninstall{/if}
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
          <Badge class="bg-slate-500 text-white"
            >{selectedRelease.namespace}/{selectedRelease.releaseName}</Badge
          >
        {/if}
      </div>

      {#if selectedRelease && !releaseStatusJson && !releaseValues && !releaseManifest && releaseHistory.length === 0 && !releaseTestLogs && actionInFlight}
        <div class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <LoadingDots /> Loading…
        </div>
      {:else if !selectedRelease && releaseHistory.length === 0 && !releaseStatusJson && !releaseValues && !releaseManifest && !releaseTestLogs}
        <p class="mt-2 text-xs text-muted-foreground">
          Click <span class="font-medium text-foreground">History</span>,
          <span class="font-medium text-foreground">Status</span>,
          <span class="font-medium text-foreground">Values</span> or
          <span class="font-medium text-foreground">Manifest</span> on any release above to inspect
          it here. Use <span class="font-medium text-foreground">History</span> to browse revisions and
          roll back.
        </p>
      {:else if releaseHistory.length > 0}
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted-foreground" for="rollback-revision"
              >Rollback to revision</label
            >
            <input
              id="rollback-revision"
              class="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs"
              placeholder="e.g. 3"
              bind:value={rollbackRevision}
            />
          </div>
          <Button
            variant="outline"
            onclick={() => void onRollbackRelease()}
            disabled={offline ||
              !rollbackRevision ||
              actionInFlight ===
                releaseActionKey("rollback", selectedRelease ?? { releaseName: "", namespace: "" })}
          >
            {#if actionInFlight === releaseActionKey("rollback", selectedRelease ?? { releaseName: "", namespace: "" })}<LoadingDots
              />{:else}Rollback{/if}
          </Button>
          {#if rollbackRevision}
            <p class="text-xs text-muted-foreground">
              Will roll back to revision <span class="font-semibold text-foreground"
                >{rollbackRevision}</span
              >
            </p>
          {/if}
        </div>
      {/if}

      {#if releaseHistory.length > 0}
        {@const currentRevision = [...releaseHistory].sort(
          (a, b) => Number(b.revision ?? 0) - Number(a.revision ?? 0),
        )[0]?.revision}
        <div class="mt-3 overflow-x-auto">
          <TableSurface maxHeightClass="max-h-80">
            <Table.Table class="table-fixed">
              <Table.TableHeader>
                <Table.TableRow>
                  <Table.TableHead class="w-[10%]">Rev</Table.TableHead>
                  <Table.TableHead class="w-[12%]">Status</Table.TableHead>
                  <Table.TableHead class="w-[22%]">Updated</Table.TableHead>
                  <Table.TableHead class="w-[40%]">Description</Table.TableHead>
                  <Table.TableHead class="w-[16%] text-right">Action</Table.TableHead>
                </Table.TableRow>
              </Table.TableHeader>
              <Table.TableBody>
                {#each releaseHistory as entry}
                  {@const isCurrent = entry.revision === currentRevision}
                  {@const isSelected = String(entry.revision) === rollbackRevision}
                  <Table.TableRow
                    class={isSelected ? "bg-amber-500/10 ring-1 ring-inset ring-amber-500/40" : ""}
                  >
                    <Table.TableCell class="font-mono">
                      {#if !isCurrent}
                        <button
                          type="button"
                          class="rounded px-1 font-mono text-sm underline decoration-dotted underline-offset-2 hover:bg-muted"
                          title="Select revision {entry.revision} for rollback"
                          onclick={() => {
                            rollbackRevision = String(entry.revision);
                          }}
                        >
                          {entry.revision}
                        </button>
                      {:else}
                        <span class="px-1">{entry.revision}</span>
                      {/if}
                      {#if isCurrent}
                        <Badge class="ml-1 bg-emerald-600 text-[10px] text-white">current</Badge>
                      {/if}
                    </Table.TableCell>
                    <Table.TableCell
                      >{releaseStatusLabels[(entry.status ?? "").toLowerCase()] ??
                        entry.status ??
                        "-"}</Table.TableCell
                    >
                    <Table.TableCell class="text-xs">{entry.updated ?? "-"}</Table.TableCell>
                    <Table.TableCell>
                      <div class="truncate text-xs" title={entry.description ?? ""}>
                        {entry.description ?? "-"}
                      </div>
                    </Table.TableCell>
                    <Table.TableCell class="text-right">
                      {#if !isCurrent}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => void onRollbackRelease(String(entry.revision))}
                          disabled={offline ||
                            actionInFlight ===
                              releaseActionKey(
                                "rollback",
                                selectedRelease ?? { releaseName: "", namespace: "" },
                              )}
                          title="Rollback to revision {entry.revision}"
                        >
                          {#if actionInFlight === releaseActionKey("rollback", selectedRelease ?? { releaseName: "", namespace: "" })}<LoadingDots
                            />{:else}Rollback{/if}
                        </Button>
                      {/if}
                    </Table.TableCell>
                  </Table.TableRow>
                {/each}
              </Table.TableBody>
            </Table.Table>
          </TableSurface>
        </div>
      {/if}
      {#if releaseStatusJson}
        <div class="mt-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-muted-foreground">Status (JSON)</p>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => void navigator.clipboard.writeText(releaseStatusJson ?? "")}
            title="Copy to clipboard">Copy</button
          >
        </div>
        <pre
          class="mt-1 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseStatusJson}</pre>
      {/if}
      {#if releaseValues}
        <div class="mt-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-muted-foreground">
            Values (YAML, merged with defaults)
          </p>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => void navigator.clipboard.writeText(releaseValues ?? "")}
            title="Copy to clipboard">Copy</button
          >
        </div>
        <pre
          class="mt-1 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseValues}</pre>
      {/if}
      {#if releaseManifest}
        <div class="mt-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-muted-foreground">Manifest (YAML)</p>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => void navigator.clipboard.writeText(releaseManifest ?? "")}
            title="Copy to clipboard">Copy</button
          >
        </div>
        <pre
          class="mt-1 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseManifest}</pre>
      {/if}
      {#if releaseTestLogs}
        <div class="mt-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-muted-foreground">Test logs</p>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => void navigator.clipboard.writeText(releaseTestLogs ?? "")}
            title="Copy to clipboard">Copy</button
          >
        </div>
        <pre
          class="mt-1 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{releaseTestLogs}</pre>
      {/if}
    </div>
  </Card.Content>
</Card.Root>

{#if installValuesDialog}
  <button
    type="button"
    class="fixed inset-0 z-[190] bg-black/40"
    aria-label="Close values editor"
    onclick={() => (installValuesDialog = null)}
  ></button>
  <div
    class="fixed inset-y-6 right-6 z-[195] flex w-[min(70vw,800px)] flex-col rounded-lg border bg-background shadow-2xl"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">
          Edit values: {installForm.chart.trim() || "chart"}
          <span class="text-xs font-normal text-muted-foreground">
            · ns {installForm.namespace.trim() || "default"}
            {#if installVersion.trim()}· v{installVersion.trim()}{/if}
          </span>
        </div>
        <div class="text-[11px] text-muted-foreground">
          Prefilled from <code>helm show values</code>. Passed via
          <code>--values &lt;tmpfile&gt;</code> on install.
        </div>
      </div>
      <Button variant="ghost" size="sm" onclick={() => (installValuesDialog = null)}>Close</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4">
      {#if installValuesDialog.loadingDefaults}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <LoadingDots /> Loading chart defaults…
        </div>
      {:else}
        {#if installValuesDialog.error}
          <div
            class="mb-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            {installValuesDialog.error}
          </div>
        {/if}
        <div class="min-h-[60vh] overflow-hidden rounded border border-slate-800 bg-slate-950/70">
          <YamlEditor
            value={installValuesDialog.yaml}
            onChange={(v) => {
              if (installValuesDialog) installValuesDialog = { ...installValuesDialog, yaml: v };
            }}
          />
        </div>
      {/if}
    </div>
    <div class="flex items-center justify-between border-t px-4 py-3">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onclick={async () => {
            if (!installValuesDialog) return;
            const confirmed = await confirmAction(
              "Reset values to chart defaults? Your edits will be lost.",
              "Reset to defaults",
            );
            if (!confirmed) return;
            installValuesDialog = { ...installValuesDialog, yaml: installValuesDialog.defaults };
          }}
          disabled={installValuesDialog.loadingDefaults}
          title="Restore chart defaults"
        >
          Reset to defaults
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground"
          onclick={() => {
            installValuesYaml = null;
            installValuesForChart = null;
            installValuesDialog = null;
          }}
          title="Clear saved values — chart defaults will be used on install"
        >
          Clear values
        </Button>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" onclick={() => (installValuesDialog = null)}>
          Cancel
        </Button>
        <Button
          size="sm"
          class="bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={installValuesDialog.loadingDefaults}
          onclick={() => {
            if (installValuesDialog) {
              installValuesYaml = installValuesDialog.yaml.trim() || null;
              installValuesForChart = installValuesYaml ? installForm.chart.trim() : null;
              installValuesDialog = null;
            }
          }}
        >
          Apply values
        </Button>
      </div>
    </div>
  </div>
{/if}
