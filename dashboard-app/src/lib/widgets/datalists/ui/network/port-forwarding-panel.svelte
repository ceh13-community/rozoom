<script lang="ts">
  import { toast } from "svelte-sonner";
  import { getTimeDifference } from "$shared";
  import type { PageData } from "$entities/cluster";
  import { selectedNamespace } from "$features/namespace-management";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import { openExternalUrl } from "$shared/api/in-app-browser";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { popOutPortForwardPreview } from "$shared/lib/port-forward-preview";
  import { requestPortForwardStartMode } from "$shared/lib/port-forward-start-mode";
  import { isTauriAvailable } from "$shared/lib/tauri-runtime";
  import { resolveClusterIds, resolvePrimaryClusterId } from "$shared/lib/cluster-ids";
  import { Button, SortingButton } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import * as Table from "$shared/ui/table";
  import * as Card from "$shared/ui/card";
  import InlineNotice from "$shared/ui/inline-notice.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import {
    activePortForwards,
    startPortForward,
    stopPortForward,
    type PortForwardProcess,
  } from "$shared/api/port-forward";

  interface Props {
    data: PageData & {
      uuid?: string;
    };
  }

  const { data }: Props = $props();

  const clusterIds = $derived.by(() => resolveClusterIds({ uuid: data.uuid, slug: data.slug }));
  const clusterId = $derived(resolvePrimaryClusterId({ uuid: data.uuid, slug: data.slug }));

  function getRandomLocalPort() {
    return Math.floor(Math.random() * (60999 - 30000 + 1)) + 30000;
  }

  let namespace = $state("default");
  let namespaceOptions = $state<string[]>(["default"]);
  let loadingNamespaces = $state(false);
  let resource = $state("");
  let selectedResource = $state("");
  let localPort = $state(String(getRandomLocalPort()));
  let remotePort = $state("80");
  let busy = $state(false);
  let loadingResources = $state(false);
  let errorMessage = $state<string | null>(null);
  let stoppingForwardKeys = $state<Set<string>>(new Set());
  let resourceSuggestions = $state<Array<{ value: string; label: string; port: number | null }>>([]);
  let sortBy = $state<"namespace" | "resource" | "localPort" | "remotePort" | "status" | "health" | "lastEvent">("namespace");
  let sortDirection = $state<"asc" | "desc">("asc");

  function showActionSuccess(message: string) {
    errorMessage = null;
    toast.success(message);
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  function asItems(value: unknown): Array<Record<string, unknown>> {
    if (!value || typeof value !== "object") return [];
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
  }

  $effect(() => {
    const selected = $selectedNamespace;
    if (!selected || selected === "all") {
      namespace = namespaceOptions[0] ?? "default";
      return;
    }
    namespace = selected;
  });

  const clusterForwards = $derived.by(() => {
    const entries = Object.entries($activePortForwards)
      .map(([key, value]) => ({ key, value }))
      .filter(
        ({ value }) =>
          Boolean(value) &&
          clusterIds.includes((value as PortForwardProcess).clusterId) &&
          (value as PortForwardProcess).isRunning,
      )
      .map(({ key, value }) => ({ key, ...(value as PortForwardProcess) }));

    return entries;
  });

  function compareText(left: string, right: string) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  function toggleSort(column: typeof sortBy) {
    if (sortBy !== column) {
      sortBy = column;
      sortDirection = column === "lastEvent" ? "desc" : "asc";
      return;
    }
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  }

  const sortedClusterForwards = $derived.by(() =>
    [...clusterForwards].sort((left, right) => {
      const leftValue =
        sortBy === "namespace"
          ? left.namespace
          : sortBy === "resource"
            ? left.resource
            : sortBy === "localPort"
              ? left.localPort
              : sortBy === "remotePort"
                ? left.remotePort
                : sortBy === "status"
                  ? "Running"
                  : sortBy === "health"
                    ? resolveHealth(left)
                    : (left.lastHeartbeatAt ?? left.startedAt ?? 0);
      const rightValue =
        sortBy === "namespace"
          ? right.namespace
          : sortBy === "resource"
            ? right.resource
            : sortBy === "localPort"
              ? right.localPort
              : sortBy === "remotePort"
                ? right.remotePort
                : sortBy === "status"
                  ? "Running"
                  : sortBy === "health"
                    ? resolveHealth(right)
                    : (right.lastHeartbeatAt ?? right.startedAt ?? 0);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : compareText(String(leftValue), String(rightValue));
      return sortDirection === "asc" ? result : result * -1;
    }),
  );

  function formatEventAge(timestamp: number | null): string {
    if (!timestamp) return "-";
    return `${getTimeDifference(new Date(timestamp))} ago`;
  }

  function resolveHealth(forward: PortForwardProcess) {
    if (forward.lastError) return "Degraded";
    return "Healthy";
  }

  function parsePort(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
    return parsed;
  }

  function normalizeResource(value: string): string {
    return value.trim();
  }

  async function openExternal(url: string) {
    try {
      await openExternalUrl(url);
      errorMessage = null;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to open URL externally.";
    }
  }

  async function loadNamespaceOptions() {
    if (!clusterId) return;
    loadingNamespaces = true;
    try {
      const response = await kubectlJson<{ items?: Array<Record<string, unknown>> }>("get namespaces", {
        clusterId,
      });
      const options = asItems(response)
        .map((item) => String(asRecord(item.metadata).name ?? ""))
        .filter((name) => name.length > 0)
        .sort((left, right) => left.localeCompare(right));
      namespaceOptions = options.length > 0 ? options : ["default"];
      if (!namespaceOptions.includes(namespace)) {
        namespace = namespaceOptions[0] ?? "default";
      }
    } catch {
      namespaceOptions = ["default"];
      if (!namespace.trim()) namespace = "default";
    } finally {
      loadingNamespaces = false;
    }
  }

  async function loadResourceSuggestions() {
    if (!clusterId || !namespace.trim() || namespace.trim() === "all") {
      resourceSuggestions = [];
      return;
    }

    loadingResources = true;
    const ns = namespace.trim();
    try {
      const [services, pods] = await Promise.all([
        kubectlJson<{ items?: Array<Record<string, unknown>> }>(`get services -n ${ns}`, { clusterId }),
        kubectlJson<{ items?: Array<Record<string, unknown>> }>(`get pods -n ${ns}`, { clusterId }),
      ]);

      const serviceOptions = asItems(services).map((item: Record<string, unknown>) => {
        const metadata = asRecord(item.metadata);
        const spec = asRecord(item.spec);
        const name = String(metadata.name ?? "");
        const ports = Array.isArray(spec.ports) ? (spec.ports as Array<Record<string, unknown>>) : [];
        const port = ports.length > 0 ? Number(ports[0].port ?? 0) || null : null;
        return {
          value: `svc/${name}`,
          label: `Service: ${name}${port ? ` (${port})` : ""}`,
          port,
        };
      });

      const podOptions = asItems(pods).map((item: Record<string, unknown>) => {
        const metadata = asRecord(item.metadata);
        const spec = asRecord(item.spec);
        const name = String(metadata.name ?? "");
        const containers = Array.isArray(spec.containers)
          ? (spec.containers as Array<Record<string, unknown>>)
          : [];
        const firstContainer = containers[0] ?? {};
        const ports = Array.isArray(firstContainer.ports)
          ? (firstContainer.ports as Array<Record<string, unknown>>)
          : [];
        const port = ports.length > 0 ? Number(ports[0].containerPort ?? 0) || null : null;
        return {
          value: `pod/${name}`,
          label: `Pod: ${name}${port ? ` (${port})` : ""}`,
          port,
        };
      });

      resourceSuggestions = [...serviceOptions, ...podOptions].filter((item) => item.value !== "svc/" && item.value !== "pod/");
    } catch {
      resourceSuggestions = [];
    } finally {
      loadingResources = false;
    }
  }

  function applySelectedResource(value: string) {
    selectedResource = value;
    resource = value;
    const matched = resourceSuggestions.find((item) => item.value === value);
    if (!matched?.port) return;
    remotePort = String(matched.port);
    if (localPort === "8080" || localPort === "80") {
      localPort = String(matched.port);
    }
  }

  async function copyTextToClipboard(text: string, successMessage: string) {
    if (typeof window === "undefined") return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      showActionSuccess(successMessage);
    } catch {
      errorMessage = "Failed to copy to clipboard.";
    }
  }

  async function handleStart() {
    const ns = namespace.trim() || "default";
    const targetResource = normalizeResource(resource);
    const local = parsePort(localPort);
    const remote = parsePort(remotePort);

    if (!clusterId) {
      errorMessage = "Cluster ID is missing.";
      return;
    }
    if (!targetResource || !targetResource.includes("/")) {
      errorMessage = "Resource must be in format kind/name, for example svc/my-service.";
      return;
    }
    if (!local || !remote) {
      errorMessage = "Ports must be integers from 1 to 65535.";
      return;
    }
    if (!isTauriAvailable()) {
      errorMessage = "Port-forwarding is available only in the desktop runtime.";
      return;
    }
    const startMode = requestPortForwardStartMode(remote);
    if (!startMode) return;
    const existingTargetForward = clusterForwards.find(
      (forward) =>
        forward.namespace === ns && forward.resource === targetResource && forward.remotePort === remote,
    );
    if (existingTargetForward) {
      if (existingTargetForward.localPort === local) {
        const existingUrl = buildForwardUrl(existingTargetForward);
        showActionSuccess(
          `Port-forward is already running: ${ns} ${targetResource} ${existingTargetForward.localPort}:${remote}`,
        );
        if (startMode === "start-and-open") {
          void popOutPortForwardPreview(existingUrl);
        }
        return;
      }
      const confirmRestart = await confirmAction(
        `Port-forward for ${targetResource} is already running on local port ${existingTargetForward.localPort}. Restart on port ${local}?`,
        "Restart port-forward",
      );
      if (!confirmRestart) return;
      try {
        await stopPortForward(existingTargetForward.key);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Failed to restart existing port-forward.";
        return;
      }
    }
    if (clusterForwards.some((forward) => forward.localPort === local)) {
      errorMessage = `Local port ${local} is already in use by another running port-forward.`;
      return;
    }

    busy = true;
    errorMessage = null;

    const uniqueKey = `${clusterId}:${ns}:${targetResource}:${local}:${remote}`;

    try {
      const result = await startPortForward({
        namespace: ns,
        resource: targetResource,
        remotePort: remote,
        localPort: local,
        clusterId,
        uniqueKey,
      });

      if (!result.success) {
        errorMessage = result.error ?? "Failed to start port-forward.";
        return;
      }

      showActionSuccess(`Port-forward started: ${ns} ${targetResource} ${local}:${remote}`);
      const scheme = remote === 443 || remote === 8443 ? "https" : "http";
      const url = `${scheme}://127.0.0.1:${local}`;
      if (startMode === "start-and-open") {
        void popOutPortForwardPreview(url);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to start port-forward.";
    } finally {
      busy = false;
    }
  }

  async function handleStop(uniqueKey: string) {
    if (stoppingForwardKeys.has(uniqueKey)) return;
    const confirmed = await confirmAction("Stop this port-forward?", "Stop port-forward");
    if (!confirmed) return;
    stoppingForwardKeys = new Set([...stoppingForwardKeys, uniqueKey]);
    try {
      await stopPortForward(uniqueKey);
      errorMessage = null;
      toast.success("Port-forward stopped.");
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to stop port-forward.";
    } finally {
      const next = new Set(stoppingForwardKeys);
      next.delete(uniqueKey);
      stoppingForwardKeys = next;
    }
  }

  function inferForwardScheme(forward: PortForwardProcess): "http" | "https" {
    if (forward.remotePort === 443 || forward.remotePort === 8443) return "https";
    const message = String(forward.lastMessage ?? "").toLowerCase();
    if (message.includes("https") || message.includes("tls")) return "https";
    return "http";
  }

  function buildForwardUrl(forward: PortForwardProcess): string {
    return `${inferForwardScheme(forward)}://127.0.0.1:${forward.localPort}`;
  }

  $effect(() => {
    void loadNamespaceOptions();
  });

  $effect(() => {
    void loadResourceSuggestions();
  });

</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <h2 class="text-lg font-semibold">Port Forwarding</h2>
    <p class="text-sm text-muted-foreground">
      Start and manage local forwards for services and pods in the selected cluster.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
  {#if errorMessage}
    <InlineNotice
      variant="destructive"
      title="Action failed"
      dismissible
      onDismiss={() => {
        errorMessage = null;
      }}
    >
      {errorMessage}
    </InlineNotice>
  {/if}

  <div class="grid gap-4 md:grid-cols-3">
    <DiagnosticSummaryCard title="Active forwards">
      <p class="text-sm font-semibold text-foreground">{clusterForwards.length}</p>
      <p class="text-xs text-muted-foreground">Running forwards for this cluster.</p>
    </DiagnosticSummaryCard>
    <DiagnosticSummaryCard title="Namespace">
      <p class="text-sm font-semibold text-foreground">{namespace || "default"}</p>
      <p class="text-xs text-muted-foreground">Selected namespace scope.</p>
    </DiagnosticSummaryCard>
    <DiagnosticSummaryCard title="Detected resources">
      <p class="text-sm font-semibold text-foreground">{resourceSuggestions.length}</p>
      <p class="text-xs text-muted-foreground">
        {loadingResources ? "Refreshing suggestions" : "Service and pod targets available."}
      </p>
    </DiagnosticSummaryCard>
  </div>

  <section class="rounded-lg border border-border/60 bg-background/40 p-4 space-y-3">
    <h3 class="text-sm font-semibold">Start Port Forward</h3>
    <div class="grid gap-3 md:grid-cols-5">
      <label class="space-y-1 text-xs text-muted-foreground">
        Namespace
        <select class="h-9 w-full rounded-md border bg-background px-2 text-sm" bind:value={namespace}>
          {#if loadingNamespaces}
            <option value={namespace}>Loading...</option>
          {:else}
            {#each namespaceOptions as option}
              <option value={option}>{option}</option>
            {/each}
          {/if}
        </select>
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Detected resources
        <select
          class="h-9 w-full rounded-md border bg-background px-2 text-sm"
          bind:value={selectedResource}
          onchange={(event) => applySelectedResource((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Select resource</option>
          {#each resourceSuggestions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Resource (kind/name)
        <Input bind:value={resource} placeholder="svc/my-service" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Local port
        <Input bind:value={localPort} inputmode="numeric" placeholder="8080" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Remote port
        <Input bind:value={remotePort} inputmode="numeric" placeholder="80" />
      </label>
    </div>
    <div class="flex justify-between">
      <div class="text-xs text-muted-foreground">
        {#if loadingResources}
          Loading resources...
        {:else}
          Detected: {resourceSuggestions.length}
        {/if}
      </div>
      <div class="flex gap-2">
        <Button type="button" variant="outline" loading={loadingResources} onclick={loadResourceSuggestions}>
          Refresh resources
        </Button>
        <Button type="button" variant="outline" loading={loadingNamespaces} onclick={loadNamespaceOptions}>
          Refresh namespaces
        </Button>
        <Button type="button" disabled={busy} onclick={handleStart}>
          {busy ? "Starting" : "Start"}
        </Button>
      </div>
    </div>
  </section>

  <section class="space-y-3">
    <div class="flex items-center justify-between border-b px-4 py-2">
      <h2 class="text-sm font-semibold">Active Forwards</h2>
      <span class="text-xs text-muted-foreground">{sortedClusterForwards.length}</span>
    </div>
    <TableSurface maxHeightClass="">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head><SortingButton label="Namespace" onclick={() => toggleSort("namespace")} /></Table.Head>
            <Table.Head><SortingButton label="Resource" onclick={() => toggleSort("resource")} /></Table.Head>
            <Table.Head><SortingButton label="Local" onclick={() => toggleSort("localPort")} /></Table.Head>
            <Table.Head><SortingButton label="Remote" onclick={() => toggleSort("remotePort")} /></Table.Head>
            <Table.Head><SortingButton label="Status" onclick={() => toggleSort("status")} /></Table.Head>
            <Table.Head><SortingButton label="Health" onclick={() => toggleSort("health")} /></Table.Head>
            <Table.Head><SortingButton label="Last event" onclick={() => toggleSort("lastEvent")} /></Table.Head>
            <Table.Head class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if sortedClusterForwards.length === 0}
            <Table.Row>
              <Table.Cell colspan={8} class="text-center">
                <TableEmptyState message="No active port-forwards." />
              </Table.Cell>
            </Table.Row>
          {:else}
            {#each sortedClusterForwards as forward}
              <Table.Row>
                <Table.Cell>{forward.namespace}</Table.Cell>
                <Table.Cell>{forward.resource}</Table.Cell>
                <Table.Cell>{forward.localPort}</Table.Cell>
                <Table.Cell>{forward.remotePort}</Table.Cell>
                <Table.Cell>Running</Table.Cell>
                <Table.Cell>{resolveHealth(forward)}</Table.Cell>
                <Table.Cell title={forward.lastMessage ?? ""}>
                  {formatEventAge(forward.lastHeartbeatAt ?? forward.startedAt)}
                  {#if forward.lastError}
                    <div class="max-w-[18rem] truncate text-[11px] text-destructive">{forward.lastError}</div>
                  {/if}
                </Table.Cell>
                <Table.Cell>
                  <div class="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onclick={() =>
                        copyTextToClipboard(`http://127.0.0.1:${forward.localPort}`, "Local URL copied.")}
                    >
                      Copy URL
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onclick={() => void popOutPortForwardPreview(buildForwardUrl(forward))}
                    >
                      Open Web
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onclick={() => void openExternal(buildForwardUrl(forward))}
                    >
                      Open external
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={stoppingForwardKeys.has(forward.key)}
                      onclick={() => handleStop(forward.key)}
                    >
                      {stoppingForwardKeys.has(forward.key) ? "Stopping..." : "Stop"}
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/each}
          {/if}
        </Table.Body>
      </Table.Root>
    </TableSurface>
  </section>
  </Card.Content>
</Card.Root>
