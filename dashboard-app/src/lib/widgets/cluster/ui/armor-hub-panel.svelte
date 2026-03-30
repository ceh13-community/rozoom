<script lang="ts">
  import {
    armorHubReports,
    armorHubState,
    installArmorProvider,
    markArmorHubUnavailable,
    runArmorScanNow,
    runArmorHubScan,
    type ArmorProviderId,
    type ArmorProviderStatus,
  } from "$features/armor-hub";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import * as Popover from "$shared/ui/popover";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();
  const hubState = $derived($armorHubState[clusterId]);
  const reportRaw = $derived($armorHubReports[clusterId] ?? null);
  const lastScanAt = $derived.by(() => {
    if (!reportRaw) return null;
    const parsed = parseJson(reportRaw) as { generatedAt?: unknown } | null;
    return typeof parsed?.generatedAt === "string" ? parsed.generatedAt : null;
  });
  const summary = $derived(hubState?.summary ?? null);
  const providers = $derived(hubState?.providers ?? []);
  const kubearmorInstalled = $derived(
    providers.some((provider) => provider.id === "kubearmor" && provider.status === "installed"),
  );
  const runScanDisabledReason = $derived.by(() => {
    if (scanning) return "Armor scan is already running";
    if (!kubearmorInstalled) return "Install KubeArmor first to enable scan";
    return "Run armor scan now";
  });
  let refreshing = $state(false);
  let providerAction = $state<Record<string, { status: "idle" | "working" | "error"; message?: string }>>({});
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  let scanning = $state(false);
  let armorReportView = $state<"report" | "raw">("report");
  let refreshRequestId = 0;
  let installRequestId = 0;
  let scanRequestId = 0;

  const summaryBadgeClass: Record<string, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    unavailable: "bg-slate-500",
  };

  const providerBadgeClass: Record<ArmorProviderStatus, string> = {
    installed: "bg-emerald-500",
    not_installed: "bg-amber-500",
    error: "bg-rose-600",
  };

  function formatDate(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function runNow() {
    if (!clusterId || refreshing) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    refreshing = true;
    void runArmorHubScan(activeClusterId, { force: true, statusOnly: true }).finally(() => {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshing = false;
    });
  }

  function canInstall(providerId: ArmorProviderId, status: ArmorProviderStatus): boolean {
    return status === "not_installed" && providerId === "kubearmor";
  }

  function parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function hasJsonReport(): boolean {
    return Boolean(reportRaw && parseJson(reportRaw));
  }

  function reportViewText(): string {
    if (!reportRaw) return "";
    if (armorReportView === "raw") return reportRaw;
    const parsed = parseJson(reportRaw) as
      | {
          generatedAt?: string;
          summary?: {
            providersInstalled?: number;
            policies?: number;
            alerts?: number;
            errors?: number;
            severity?: Record<string, number>;
          };
          providers?: Array<{ id?: string; status?: string; namespace?: string | null; releaseName?: string | null }>;
          resources?: Array<{
            resource?: string;
            available?: boolean;
            count?: number;
            details?: {
              namespaces?: string[];
              sampleResources?: string[];
              severity?: Record<string, number>;
            };
          }>;
          errors?: string[];
        }
      | null;
    if (!parsed) return reportRaw;

    const lines: string[] = [];
    lines.push("Armor scan report");
    lines.push("");
    lines.push(`Generated: ${parsed.generatedAt ?? "-"}`);
    lines.push(
      `Summary: installed ${parsed.summary?.providersInstalled ?? 0} | policies ${parsed.summary?.policies ?? 0} | alerts ${parsed.summary?.alerts ?? 0} | errors ${parsed.summary?.errors ?? 0}`,
    );
    const summarySeverity = parsed.summary?.severity ?? {};
    const severityParts = Object.entries(summarySeverity)
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([severity, count]) => `${severity} ${count}`);
    if (severityParts.length > 0) {
      lines.push(`Severity: ${severityParts.join(" | ")}`);
    }
    lines.push("");
    lines.push("Providers:");
    for (const provider of parsed.providers ?? []) {
      lines.push(
        `- ${provider.id ?? "-"}: ${provider.status ?? "-"}${provider.namespace ? ` | ns: ${provider.namespace}` : ""}${provider.releaseName ? ` | release: ${provider.releaseName}` : ""}`,
      );
    }
    lines.push("");
    lines.push("Resources:");
    for (const resource of parsed.resources ?? []) {
      lines.push(
        `- ${resource.resource ?? "-"}: ${resource.available ? "available" : "missing"} | count ${resource.count ?? 0}`,
      );
      const resourceSeverity = resource.details?.severity ?? {};
      const resourceSeverityParts = Object.entries(resourceSeverity)
        .filter(([, count]) => (count ?? 0) > 0)
        .map(([severity, count]) => `${severity} ${count}`);
      if (resourceSeverityParts.length > 0) {
        lines.push(`  severity: ${resourceSeverityParts.join(" | ")}`);
      }
      if ((resource.details?.namespaces?.length ?? 0) > 0) {
        lines.push(`  namespaces: ${(resource.details?.namespaces ?? []).join(", ")}`);
      }
      if ((resource.details?.sampleResources?.length ?? 0) > 0) {
        lines.push(`  sample: ${(resource.details?.sampleResources ?? []).join(", ")}`);
      }
    }
    if ((parsed.errors ?? []).length > 0) {
      lines.push("");
      lines.push("Errors:");
      for (const err of parsed.errors ?? []) lines.push(`- ${err}`);
    }
    return lines.join("\n");
  }

  function downloadReportJson() {
    if (!reportRaw || !hasJsonReport()) return;
    const blob = new Blob([reportRaw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "armor-scan-report.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleInstall(providerId: ArmorProviderId, title: string) {
    if (providerAction[providerId]?.status === "working") return;
    const requestId = ++installRequestId;
    const activeClusterId = clusterId;
    providerAction = { ...providerAction, [providerId]: { status: "working" } };
    actionNotice = null;
    try {
      const result = await installArmorProvider(activeClusterId, providerId);
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        const message = result.error?.trim() || `Failed to install ${title}`;
        providerAction = { ...providerAction, [providerId]: { status: "error", message } };
        actionNotice = { type: "error", text: `${title}: ${message}` };
        return;
      }
      providerAction = { ...providerAction, [providerId]: { status: "idle" } };
      actionNotice = { type: "success", text: `${title} installed via Helm.` };
      await runArmorHubScan(activeClusterId, { force: true });
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
    } catch (error) {
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const message = error instanceof Error ? error.message : `Failed to install ${title}`;
      providerAction = { ...providerAction, [providerId]: { status: "error", message } };
      actionNotice = { type: "error", text: `${title}: ${message}` };
    }
  }

  async function runScan() {
    if (!clusterId || scanning) return;
    const requestId = ++scanRequestId;
    const activeClusterId = clusterId;
    scanning = true;
    actionNotice = null;
    try {
      const result = await runArmorScanNow(activeClusterId);
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        actionNotice = { type: "error", text: result.error?.trim() || "Failed to run armor scan" };
        return;
      }
      armorReportView = "report";
      actionNotice = { type: "success", text: "Armor scan completed." };
    } finally {
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      scanning = false;
    }
  }

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    installRequestId += 1;
    scanRequestId += 1;
  });

  $effect(() => {
    if (!clusterId) return;
    if (offline) {
      markArmorHubUnavailable(clusterId, "Armor integration unavailable: cluster is offline");
      return;
    }
    void runArmorHubScan(clusterId, { force: false, statusOnly: true });
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Runtime protection integration status for KubeArmor."
        >
          KubeArmor
        </h2>
        {#if summary}
          <Badge class="text-white {summaryBadgeClass[summary.status]}">{summary.status}</Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Armor tools info"
              title="About KubeArmor"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[420px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Runtime security integrations</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">KubeArmor:</span>
                runtime enforcement for process, file, network, and capabilities policies.
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubearmor/KubeArmor"
                target="_blank"
                rel="noreferrer noopener"
              >
                KubeArmor GitHub
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" onclick={runNow} loading={refreshing} loadingLabel="Refreshing">
          <Refresh class="mr-2 h-4 w-4" /> Refresh status
        </Button>
        <Button
          onclick={runScan}
          loading={scanning}
          loadingLabel="Scanning"
          disabled={!kubearmorInstalled}
          title={runScanDisabledReason}
        >
          <span>Run armor scan</span>
        </Button>
      </div>
    </div>
    <p class="text-sm text-muted-foreground">Manual mode: Refresh status updates provider status only.</p>
    {#if !kubearmorInstalled}
      <p class="text-xs text-amber-600">
        Install KubeArmor first to enable scanning.
      </p>
    {/if}
  </Card.Header>
  <Card.Content class="space-y-6">
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

    {#if summary?.status === "unavailable"}
      <Alert.Root variant="default">
        <Alert.Title>Integrations not detected</Alert.Title>
        <Alert.Description>{summary?.message ?? "KubeArmor is not detected."}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last scan">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock4 class="h-4 w-4" />
        </div>
        <p class="text-sm font-medium text-foreground">{formatDate(lastScanAt)}</p>
        <p class="text-xs text-muted-foreground">Updates after Run armor scan.</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Summary">
        <p class="text-sm font-semibold text-foreground">{summary?.message ?? "-"}</p>
        <p class="text-xs text-muted-foreground">Providers detected: {providers.filter((p) => p.status === "installed").length}/{providers.length}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="grid gap-3 md:grid-cols-2">
      {#if providers.length === 0}
        <div class="rounded-md border border-border p-3 text-sm text-muted-foreground">
          No providers detected yet.
        </div>
      {:else}
        {#each providers as provider}
          <div class="rounded-md border border-border p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="text-sm font-semibold text-foreground">{provider.title}</p>
              <Badge class="text-white {providerBadgeClass[provider.status]}">{provider.status}</Badge>
            </div>
            {#if provider.message}
              <p class="text-xs text-muted-foreground">{provider.message}</p>
            {/if}
            {#if provider.releaseName || provider.namespace}
              <p class="mt-1 text-xs text-muted-foreground">
                Release: {provider.releaseName ?? "-"} · Namespace: {provider.namespace ?? "-"}
              </p>
            {/if}
            <div class="mt-2 flex flex-wrap gap-3 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Documentation
              </a>
              <a
                class="text-primary underline-offset-4 hover:underline"
                href={provider.githubUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </div>
            {#if canInstall(provider.id, provider.status)}
              <div class="mt-3">
                <Button
                  size="sm"
                  onclick={() => handleInstall(provider.id, provider.title)}
                  loading={providerAction[provider.id]?.status === "working"}
                  loadingLabel="Installing"
                >
                  <span>Install (Helm)</span>
                </Button>
                {#if providerAction[provider.id]?.status === "error"}
                  <p class="mt-1 text-xs text-rose-600">{providerAction[provider.id]?.message}</p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    {#if reportRaw}
      <div class="rounded-lg border border-border bg-muted/20 p-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-semibold text-foreground">Latest armor scan report</p>
          {#if hasJsonReport()}
            <div class="flex items-center gap-2">
              <select
                class="rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                bind:value={armorReportView}
              >
                <option value="report">Report view</option>
                <option value="raw">Raw JSON</option>
              </select>
              <Button size="sm" variant="outline" onclick={downloadReportJson}>Download JSON</Button>
            </div>
          {/if}
        </div>
        <pre
          class="min-h-56 max-h-[70vh] resize-y overflow-auto whitespace-pre-wrap rounded border border-border bg-background/40 p-2 text-xs text-muted-foreground"
        >{reportViewText()}</pre>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
