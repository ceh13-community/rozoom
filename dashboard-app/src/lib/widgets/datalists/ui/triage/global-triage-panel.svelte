<script lang="ts">
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import { toClusterWorkloadHref } from "$pages/cluster/model/cluster-page-workspace";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import { Input } from "$shared/ui/input";
  import { Button, SortingButton } from "$shared/ui/button";
  import { Badge } from "$shared/ui/badge";
  import * as Table from "$shared/ui/table";
  import * as Alert from "$shared/ui/alert";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import TableSummaryBar from "$shared/ui/table-summary-bar.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import {
    classifyProblemFetchError,
    discoverTriageResourceSupport,
    evaluateProblemResource,
    getGlobalTriageManifest,
    type ProblemResource,
  } from "$features/workloads-management";

  interface Props {
    data: PageData & { uuid?: string };
  }

  const { data }: Props = $props();
  const clusterId = $derived(data.uuid ?? data.slug ?? "");

  let loading = $state(false);
  let errorMessage = $state<string | null>(null);
  let search = $state("");
  let resources = $state<ProblemResource[]>([]);
  let supportedResourceTypes = $state(0);
  let unsupportedResourceTypes = $state(0);
  let failedResourceTypes = $state(0);
  let sortBy = $state<"problemScore" | "name" | "namespace" | "workload" | "status">("problemScore");
  let sortDirection = $state<"asc" | "desc">("desc");
  let pageSize = $state(100);
  let currentPage = $state(0);
  let groupBy = $state<"none" | "workload" | "namespace" | "severity">("none");
  const triageManifest = getGlobalTriageManifest();
  const MAX_CONCURRENCY = 3;
  let refreshToken = 0;

  function severityFromScore(score: number): "critical" | "warning" | "info" {
    if (score >= 200) return "critical";
    if (score >= 80) return "warning";
    return "info";
  }

  function severityLabel(severity: "critical" | "warning" | "info") {
    if (severity === "critical") return "Critical";
    if (severity === "warning") return "Warning";
    return "Low";
  }

  function severityColor(severity: "critical" | "warning" | "info") {
    if (severity === "critical") return "bg-rose-600";
    if (severity === "warning") return "bg-amber-600";
    return "bg-sky-600";
  }

  async function runWithLimit<T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>,
  ): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];
    const executing = new Set<Promise<void>>();
    for (const item of items) {
      const p = (async () => {
        try {
          const value = await task(item);
          results.push({ status: "fulfilled", value });
        } catch (reason) {
          results.push({ status: "rejected", reason });
        }
      })();
      executing.add(p);
      p.finally(() => executing.delete(p));
      if (executing.size >= limit) await Promise.race(executing);
    }
    await Promise.all(executing);
    return results;
  }

  async function refresh() {
    if (!clusterId) return;
    const token = ++refreshToken;
    loading = true;
    errorMessage = null;
    try {
      const discovery = await discoverTriageResourceSupport(clusterId, triageManifest);
      if (token !== refreshToken) return;

      const results = await runWithLimit(
        discovery.supported,
        MAX_CONCURRENCY,
        async (entry) => {
          const ns = "--all-namespaces";
          const resolved = entry.command.includes("${ns}")
            ? entry.command.replace("${ns}", ns)
            : entry.command;
          const response = await kubectlJson<{ items?: Array<Record<string, unknown>> }>(resolved, {
            clusterId,
          });
          if (typeof response === "string") throw new Error(response);
          if (!response || typeof response !== "object") return [] as ProblemResource[];
          const items = Array.isArray(response.items) ? response.items : [];
          return items
            .map((item) => evaluateProblemResource(entry, item, items))
            .filter((item) => item.problemScore > 0);
        },
      );
      if (token !== refreshToken) return;

      const nextResources: ProblemResource[] = [];
      let nextSupported = 0;
      let nextUnsupported = discovery.unsupported.length;
      let nextFailed = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          nextSupported += 1;
          nextResources.push(...result.value);
          continue;
        }
        const classification = classifyProblemFetchError(result.reason);
        if (classification === "unsupported" || classification === "forbidden") {
          nextUnsupported += 1;
        } else {
          nextFailed += 1;
        }
      }

      supportedResourceTypes = nextSupported;
      unsupportedResourceTypes = nextUnsupported;
      failedResourceTypes = nextFailed;
      resources = nextResources;
      currentPage = 0;

      if (nextSupported === 0 && (nextFailed > 0 || nextUnsupported > 0)) {
        errorMessage =
          nextFailed > 0
            ? "Failed to load all supported triage resource types."
            : "No supported triage resource types are available on this cluster.";
      }
    } catch (error) {
      if (token !== refreshToken) return;
      errorMessage = error instanceof Error ? error.message : "Failed to load triage data.";
    } finally {
      if (token === refreshToken) loading = false;
    }
  }

  function compareText(left: string, right: string) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  function toggleSort(column: typeof sortBy) {
    if (sortBy !== column) {
      sortBy = column;
      sortDirection = column === "problemScore" ? "desc" : "asc";
    } else {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    }
    currentPage = 0;
  }

  function sortValue(item: ProblemResource): string | number {
    if (sortBy === "problemScore") return item.problemScore;
    if (sortBy === "name") return item.name;
    if (sortBy === "namespace") return item.namespace ?? "cluster";
    if (sortBy === "workload") return item.workloadLabel;
    return item.status ?? "-";
  }

  const matchedResources = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return q
      ? resources.filter((item) =>
          `${item.name} ${item.namespace ?? ""} ${item.workloadLabel} ${item.status ?? ""} ${item.reason ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : resources;
  });

  const sorted = $derived.by(() => {
    return [...matchedResources].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : compareText(String(av), String(bv));
      return sortDirection === "asc" ? result : result * -1;
    });
  });

  const totalPages = $derived(Math.max(1, Math.ceil(sorted.length / pageSize)));
  const paged = $derived(sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize));

  const severityCounts = $derived.by(() => {
    let critical = 0;
    let warning = 0;
    let info = 0;
    for (const item of matchedResources) {
      const s = severityFromScore(item.problemScore);
      if (s === "critical") critical++;
      else if (s === "warning") warning++;
      else info++;
    }
    return { critical, warning, info };
  });

  type GroupEntry = { label: string; items: ProblemResource[] };
  const grouped = $derived.by<GroupEntry[] | null>(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, ProblemResource[]>();
    for (const item of sorted) {
      const key =
        groupBy === "workload"
          ? item.workloadLabel
          : groupBy === "namespace"
            ? (item.namespace ?? "cluster")
            : severityLabel(severityFromScore(item.problemScore));
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    const entries = [...map.entries()].map(([label, items]) => ({ label, items }));
    if (groupBy === "severity") {
      const order = ["Critical", "Warning", "Low"];
      entries.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    } else {
      entries.sort((a, b) => b.items.length - a.items.length);
    }
    return entries;
  });

  const summaryItems = $derived.by(() => [
    { label: "Cluster", value: resolvePageClusterName(data) },
    { label: "Findings", value: matchedResources.length },
    { label: "Supported", value: supportedResourceTypes },
    ...(unsupportedResourceTypes > 0 ? [{ label: "Unsupported", value: unsupportedResourceTypes }] : []),
    ...(failedResourceTypes > 0 ? [{ label: "Failed", value: failedResourceTypes }] : []),
  ]);

  let hasRefreshed = false;
  $effect(() => {
    if (hasRefreshed) return;
    if (!clusterId) return;
    hasRefreshed = true;
    void refresh();
  });
</script>

{#snippet problemRow(item: ProblemResource)}
  {@const severity = severityFromScore(item.problemScore)}
  <Table.Row>
    <Table.Cell>
      <Badge class="text-white {severityColor(severity)} text-[10px] h-5 px-1.5 tabular-nums">
        {item.problemScore}
      </Badge>
    </Table.Cell>
    <Table.Cell>
      <a
        class="font-medium text-foreground underline-offset-4 hover:underline"
        href={toClusterWorkloadHref(item.workloadKey, "name", clusterId)}
      >
        {item.name}
      </a>
    </Table.Cell>
    <Table.Cell class="text-muted-foreground">{item.namespace ?? "cluster"}</Table.Cell>
    <Table.Cell>{item.workloadLabel}</Table.Cell>
    <Table.Cell>{item.status ?? "-"}</Table.Cell>
    <Table.Cell class="text-muted-foreground max-w-xs truncate" title={item.reason ?? ""}>{item.reason ?? "-"}</Table.Cell>
  </Table.Row>
{/snippet}

<div class="space-y-4">
  {#if errorMessage}
    <Alert.Root variant={resources.length > 0 ? "default" : "destructive"}>
      <Alert.Title>Error</Alert.Title>
      <Alert.Description>{errorMessage}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if !loading && matchedResources.length > 0}
    <div class="flex items-center gap-3 text-sm">
      <Badge class="text-white bg-rose-600 tabular-nums">{severityCounts.critical} critical</Badge>
      <Badge class="text-white bg-amber-600 tabular-nums">{severityCounts.warning} warning</Badge>
      <Badge class="text-white bg-sky-600 tabular-nums">{severityCounts.info} low</Badge>
    </div>
  {/if}

  <TableSummaryBar items={summaryItems}>
    {#snippet children()}
      <div class="flex flex-wrap items-end justify-end gap-3">
        <div class="space-y-1">
          <div class="text-sm text-muted-foreground">Search</div>
          <Input class="w-full max-w-xl" placeholder="name, ns, workload, status..." bind:value={search} />
        </div>
        <div class="space-y-1">
          <div class="text-sm text-muted-foreground">Group by</div>
          <select
            class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            bind:value={groupBy}
          >
            <option value="none">None</option>
            <option value="severity">Severity</option>
            <option value="workload">Workload type</option>
            <option value="namespace">Namespace</option>
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          onclick={refresh}
          loading={loading}
          loadingLabel="Scanning"
        >
          Refresh triage
        </Button>
      </div>
    {/snippet}
  </TableSummaryBar>

  {#if grouped}
    {#each grouped as group (group.label)}
      <div class="space-y-1">
        <h3 class="text-sm font-semibold px-1">{group.label} <span class="text-muted-foreground font-normal">({group.items.length})</span></h3>
        <TableSurface>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head class="w-20">Score</Table.Head>
                <Table.Head>Name</Table.Head>
                <Table.Head>Namespace</Table.Head>
                <Table.Head>Workload</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Reason</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each group.items.slice(0, pageSize) as item (item.id)}
                {@render problemRow(item)}
              {/each}
              {#if group.items.length > pageSize}
                <Table.Row>
                  <Table.Cell colspan={6} class="text-center text-muted-foreground text-xs py-2">
                    Showing {pageSize} of {group.items.length} - use search to narrow down
                  </Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </TableSurface>
      </div>
    {/each}
  {:else}
    <TableSurface>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="w-20"><SortingButton label="Score" onclick={() => toggleSort("problemScore")} /></Table.Head>
            <Table.Head><SortingButton label="Name" onclick={() => toggleSort("name")} /></Table.Head>
            <Table.Head><SortingButton label="Namespace" onclick={() => toggleSort("namespace")} /></Table.Head>
            <Table.Head><SortingButton label="Workload" onclick={() => toggleSort("workload")} /></Table.Head>
            <Table.Head><SortingButton label="Status" onclick={() => toggleSort("status")} /></Table.Head>
            <Table.Head>Reason</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if paged.length === 0}
            <Table.Row>
              <Table.Cell colspan={6} class="text-center py-6">
                {#if loading}
                  <div class="px-4 py-6 text-sm text-muted-foreground">Scanning cluster resources<LoadingDots /></div>
                {:else}
                  <TableEmptyState message="No problems found." />
                {/if}
              </Table.Cell>
            </Table.Row>
          {:else}
            {#each paged as item (item.id)}
              {@render problemRow(item)}
            {/each}
          {/if}
        </Table.Body>
      </Table.Root>
    </TableSurface>

    {#if totalPages > 1}
      <div class="flex items-center justify-between text-sm text-muted-foreground px-1">
        <span>Page {currentPage + 1} of {totalPages} ({sorted.length} findings)</span>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 0} onclick={() => currentPage--}>Previous</Button>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onclick={() => currentPage++}>Next</Button>
        </div>
      </div>
    {/if}
  {/if}
</div>
