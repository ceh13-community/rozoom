<script lang="ts">
  import {
    complianceHubState,
    fetchLatestKubeBenchLogs,
    installComplianceProvider,
    markComplianceHubUnavailable,
    runKubeBenchScanNow,
    runComplianceHubScan,
    runKubescapeScanNow,
    type ComplianceProvider,
    type ComplianceProviderId,
    type ComplianceProviderStatus,
    type ComplianceFinding,
  } from "$features/compliance-hub";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import * as Table from "$shared/ui/table";
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  const hubState = $derived($complianceHubState[clusterId]);
  const summary = $derived(hubState?.summary ?? null);
  const providers = $derived(hubState?.providers ?? []);
  const findings = $derived(hubState?.findings ?? []);
  const kubescapeInstalled = $derived(
    providers.some((provider) => provider.id === "kubescape" && provider.status === "installed"),
  );
  const runKubescapeDisabledReason = $derived.by(() => {
    if (triggeringKubescapeScan) return "Kubescape scan is already running";
    if (refreshing) return "Wait until status refresh is complete";
    if (!kubescapeInstalled) return "Install Kubescape first to enable scan";
    return "Run Kubescape scan now";
  });
  const latestKubeBenchScanAt = $derived.by(() => {
    const kubeBenchFindings = findings.filter((finding) => finding.provider === "kube-bench");
    if (kubeBenchFindings.length === 0) return kubeBenchLastScanAt;
    const latest = kubeBenchFindings.reduce((current, next) => {
      const currentTs = Date.parse(current.updatedAt);
      const nextTs = Date.parse(next.updatedAt);
      if (Number.isNaN(nextTs)) return current;
      if (Number.isNaN(currentTs) || nextTs > currentTs) return next;
      return current;
    }, kubeBenchFindings[0]);
    return latest.updatedAt || kubeBenchLastScanAt;
  });
  const lastScanAt = $derived.by(() => {
    if (findings.length === 0) return summary?.lastRunAt ?? null;
    const latestFindingAt = findings.reduce((latest, finding) => {
      const latestTs = Date.parse(latest);
      const currentTs = Date.parse(finding.updatedAt);
      if (Number.isNaN(currentTs)) return latest;
      if (Number.isNaN(latestTs) || currentTs > latestTs) return finding.updatedAt;
      return latest;
    }, findings[0]?.updatedAt ?? "");
    return latestFindingAt || null;
  });

  let refreshing = $state(false);
  let triggeringKubescapeScan = $state(false);
  let phaseFilter = $state<"all" | "running" | "completed" | "failed" | "unknown">("all");
  let detailsSeverityFilter = $state<"all" | "problems">("problems");
  let kubeBenchLogsLoading = $state(false);
  let kubeBenchLogs = $state<string | null>(null);
  let kubeBenchLogsRaw = $state<string | null>(null);
  let kubeBenchLogsTitle = $state<string | null>(null);
  let kubeBenchLastScanAt = $state<string | null>(null);
  let kubeBenchLogsView = $state<"report" | "raw">("report");
  let providerAction = $state<Record<string, { status: "idle" | "working" | "error"; message?: string }>>({});
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  let refreshRequestId = 0;
  let kubescapeRequestId = 0;
  let installRequestId = 0;
  let logsRequestId = 0;

  const summaryBadgeClass: Record<string, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    unavailable: "bg-slate-500",
  };

  const providerBadgeClass: Record<ComplianceProviderStatus, string> = {
    installed: "bg-emerald-500",
    not_installed: "bg-amber-500",
    error: "bg-rose-600",
  };
  const providerBadgeLabel: Record<ComplianceProviderStatus, string> = {
    installed: "installed",
    not_installed: "",
    error: "error",
  };

  const severityClass: Record<string, string> = {
    critical: "bg-rose-700",
    high: "bg-rose-600",
    medium: "bg-amber-500",
    low: "bg-yellow-500",
    info: "bg-slate-500",
  };

  const filteredFindings = $derived.by(() => {
    if (phaseFilter === "all") return findings;
    return findings.filter((finding) => {
      const phase = (finding.phase || "").toLowerCase();
      if (phaseFilter === "running") return phase.includes("run") || phase.includes("progress");
      if (phaseFilter === "completed") return phase.includes("complete") || phase.includes("done");
      if (phaseFilter === "failed") return phase.includes("fail") || phase.includes("error");
      return !phase || phase === "unknown";
    });
  });

  function formatDate(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function findingMessageLines(finding: ComplianceFinding): string[] {
    const details: string[] = [];
    if (finding.message?.trim()) details.push(finding.message.trim());
    if (finding.namespace) details.push(`Namespace: ${finding.namespace}`);
    if (finding.control) details.push(`Resource: ${finding.control}`);
    if (finding.phase) details.push(`Phase: ${finding.phase}`);
    if (details.length === 0) details.push("No details reported by provider");
    return details;
  }

  function hasDetails(finding: ComplianceFinding): boolean {
    return Boolean(finding.details?.totals || finding.details?.controls?.length);
  }

  function detailsSummary(finding: ComplianceFinding): string {
    const totals = finding.details?.totals;
    const sections = finding.details?.controls?.length ?? 0;
    if (!totals) return `Controls breakdown (${sections})`;
    return `Controls: ${sections} · FAIL ${totals.fail} · WARN ${totals.warn} · PASS ${totals.pass}`;
  }

  function visibleControls(finding: ComplianceFinding) {
    const controls = finding.details?.controls ?? [];
    if (detailsSeverityFilter === "all") return controls;
    return controls.filter((control) => control.fail > 0 || control.warn > 0);
  }

  function formatPossiblyJsonText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return text;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return text;
    }
  }

  function parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function toHumanReportFromJson(text: string): string | null {
    const parsed = parseJson(text);
    if (!parsed || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const controls = Array.isArray(root.Controls) ? (root.Controls as Array<Record<string, unknown>>) : [];
    const totals =
      root.Totals && typeof root.Totals === "object" ? (root.Totals as Record<string, unknown>) : undefined;

    const oneLine = (value: unknown): string =>
      String(value ?? "")
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? "";

    const testSections = controls.flatMap((control) => {
      const tests = Array.isArray(control.tests) ? (control.tests as Array<Record<string, unknown>>) : [];
      return tests.map((test) => {
        const results = Array.isArray(test.results) ? (test.results as Array<Record<string, unknown>>) : [];
        const problems = results
          .filter((result) => {
            const status = String(result.status ?? "").toUpperCase();
            return status === "FAIL" || status === "WARN";
          })
          .map((result) => ({
            status: String(result.status ?? "").toUpperCase(),
            number: String(result.test_number ?? "-"),
            desc: oneLine(result.test_desc),
            remediation: oneLine(result.remediation),
          }));

        return {
          id: String(test.section ?? "-"),
          desc: String(test.desc ?? ""),
          pass: Number(test.pass ?? 0),
          fail: Number(test.fail ?? 0),
          warn: Number(test.warn ?? 0),
          problems,
        };
      });
    });

    if (testSections.length === 0) return null;

    const lines: string[] = [];
    lines.push("Compliance report");
    lines.push("");
    lines.push(
      `Totals: PASS ${Number(totals?.total_pass ?? 0)} | FAIL ${Number(totals?.total_fail ?? 0)} | WARN ${Number(totals?.total_warn ?? 0)} | INFO ${Number(totals?.total_info ?? 0)}`,
    );
    lines.push("");
    lines.push("Sections:");
    for (const section of testSections) {
      lines.push(
        `${section.id}: PASS ${section.pass} | FAIL ${section.fail} | WARN ${section.warn}${section.desc ? ` | ${section.desc}` : ""}`,
      );
      if (section.problems.length > 0) {
        for (const problem of section.problems) {
          lines.push(`  - [${problem.status}] ${problem.number}: ${problem.desc}`);
          if (problem.remediation) {
            lines.push(`    Fix: ${problem.remediation}`);
          }
        }
      }
    }
    return lines.join("\n");
  }

  function visibleKubeBenchLogs(): string {
    if (!kubeBenchLogs) return "";
    if (kubeBenchLogsView === "raw") return kubeBenchLogs;
    return toHumanReportFromJson(kubeBenchLogs) ?? kubeBenchLogs;
  }

  function hasJsonLogs(): boolean {
    return Boolean(kubeBenchLogsRaw && parseJson(kubeBenchLogsRaw));
  }

  function downloadKubeBenchJson() {
    if (!kubeBenchLogsRaw || !hasJsonLogs()) return;
    const blob = new Blob([kubeBenchLogsRaw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(kubeBenchLogsTitle || "compliance-report").replace(/\s+/g, "-").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function runNow() {
    if (!clusterId || refreshing) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    refreshing = true;
    actionNotice = null;
    void runComplianceHubScan(activeClusterId, { force: true, statusOnly: true }).finally(() => {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshing = false;
    });
  }

  async function runKubescapeNow() {
    if (!clusterId || triggeringKubescapeScan) return;
    const requestId = ++kubescapeRequestId;
    const activeClusterId = clusterId;
    triggeringKubescapeScan = true;
    actionNotice = null;
    try {
      const result = await runKubescapeScanNow(activeClusterId);
      if (requestId !== kubescapeRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        actionNotice = {
          type: "error",
          text: result.error?.trim() || "Failed to trigger Kubescape scan",
        };
        return;
      }
      actionNotice = {
        type: "success",
        text:
          `Kubescape scan started.\n` +
          `Namespace: ${result.namespace ?? "kubescape"}\n` +
          `Scan: ${result.scanName ?? "dashboard-manual-*"}`,
      };
    } finally {
      if (requestId !== kubescapeRequestId || activeClusterId !== clusterId) return;
      triggeringKubescapeScan = false;
    }
  }

  function canInstall(provider: ComplianceProvider): boolean {
    return provider.status === "not_installed";
  }

  async function handleInstall(providerId: ComplianceProviderId, title: string) {
    if (providerAction[providerId]?.status === "working") return;
    const requestId = ++installRequestId;
    const activeClusterId = clusterId;
    providerAction = {
      ...providerAction,
      [providerId]: { status: "working" },
    };
    actionNotice = null;

    try {
      if (providerId === "kube-bench") {
        const result = await runKubeBenchScanNow(activeClusterId);
        if (requestId !== installRequestId || activeClusterId !== clusterId) return;
        if (!result.success) {
          const message = result.error?.trim() || `Failed to install ${title}`;
          providerAction = {
            ...providerAction,
            [providerId]: { status: "error", message },
          };
          actionNotice = { type: "error", text: `${title}: ${message}` };
          return;
        }

        providerAction = {
          ...providerAction,
          [providerId]: { status: "idle" },
        };
        actionNotice = {
          type: "success",
          text:
            `${title} job started.\n` +
            `Namespace: ${result.namespace ?? "kube-system"}\n` +
            `Job: ${result.jobName ?? "dashboard-kube-bench-*"}`,
        };
        kubeBenchLastScanAt = new Date().toISOString();
      } else {
        const result = await installComplianceProvider(clusterId, providerId);
        if (!result.success) {
          const message = result.error?.trim() || `Failed to install ${title}`;
          providerAction = {
            ...providerAction,
            [providerId]: { status: "error", message },
          };
          actionNotice = { type: "error", text: `${title}: ${message}` };
          return;
        }

        providerAction = {
          ...providerAction,
          [providerId]: { status: "idle" },
        };
        actionNotice = { type: "success", text: `${title} installed via Helm.` };
      }

      await runComplianceHubScan(activeClusterId, { force: true, statusOnly: true });
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
    } catch (error) {
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const message = error instanceof Error ? error.message : `Failed to install ${title}`;
      providerAction = {
        ...providerAction,
        [providerId]: { status: "error", message },
      };
      actionNotice = { type: "error", text: `${title}: ${message}` };
    }
  }

  async function viewLatestKubeBenchLogs() {
    if (!clusterId || kubeBenchLogsLoading) return;
    const requestId = ++logsRequestId;
    const activeClusterId = clusterId;
    kubeBenchLogsLoading = true;
    actionNotice = null;
    try {
      const result = await fetchLatestKubeBenchLogs(activeClusterId);
      if (requestId !== logsRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        actionNotice = {
          type: "error",
          text: result.error?.trim() || "Failed to load kube-bench logs",
        };
        return;
      }
      kubeBenchLogsTitle = result.jobName ? `Latest kube-bench job: ${result.jobName}` : null;
      kubeBenchLastScanAt = result.createdAt ?? null;
      kubeBenchLogsRaw = result.logs || null;
      kubeBenchLogs = result.logs ? formatPossiblyJsonText(result.logs) : "(empty logs)";
      kubeBenchLogsView = "report";
      actionNotice = { type: "success", text: "Loaded latest kube-bench logs." };
    } finally {
      if (requestId !== logsRequestId || activeClusterId !== clusterId) return;
      kubeBenchLogsLoading = false;
    }
  }

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    kubescapeRequestId += 1;
    installRequestId += 1;
    logsRequestId += 1;
  });

  $effect(() => {
    if (!clusterId) return;

    if (offline) {
      markComplianceHubUnavailable(clusterId, "Compliance checks unavailable: cluster is offline");
      return;
    }

    void runComplianceHubScan(clusterId, { force: false, statusOnly: true });

    return () => {
      // Manual mode: no background polling timers.
    };
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold" title="Kubescape and kube-bench status, scans, and findings.">
          Compliance Hub
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
              aria-label="Compliance tools info"
              title="About Kubescape and kube-bench"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[420px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Compliance tools in this panel</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">Kubescape:</span>
                Kubernetes security posture and compliance scanner (CIS/NSA/MITRE and more).
              </p>
              <p>
                <span class="font-medium text-foreground">kube-bench:</span>
                CIS Benchmark checks for Kubernetes nodes and control plane.
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubescape/kubescape"
                target="_blank"
                rel="noreferrer noopener"
              >
                Kubescape GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://github.com/aquasecurity/kube-bench"
                target="_blank"
                rel="noreferrer noopener"
              >
                kube-bench GitHub
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onclick={runNow}
          loading={refreshing}
          loadingLabel="Refreshing"
          disabled={triggeringKubescapeScan}
        >
          <Refresh class="mr-2 h-4 w-4" /> Refresh status
        </Button>
        <Button
          onclick={runKubescapeNow}
          loading={triggeringKubescapeScan}
          loadingLabel="Running"
          disabled={refreshing || !kubescapeInstalled}
          title={runKubescapeDisabledReason}
        >
          <span>Run Kubescape Scan now</span>
        </Button>
      </div>
    </div>
    <p class="text-sm text-muted-foreground">
      Unified compliance view for Kubescape and kube-bench. Refresh status updates status only.
    </p>
    {#if !kubescapeInstalled}
      <p class="text-xs text-amber-600">
        Install Kubescape first to enable manual scan.
      </p>
    {/if}
  </Card.Header>
  <Card.Content class="space-y-6">
    {#if actionNotice?.type === "success"}
      <Alert.Root variant="default">
        <Alert.Title>Action completed</Alert.Title>
        <Alert.Description class="whitespace-pre-line">{actionNotice.text}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if actionNotice?.type === "error"}
      <Alert.Root variant="destructive">
        <Alert.Title>Action failed</Alert.Title>
        <Alert.Description>{actionNotice.text}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last scan">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock4 class="h-4 w-4" />
        </div>
        <p class="text-sm font-medium text-foreground">{formatDate(lastScanAt)}</p>
        <p class="text-xs text-muted-foreground">Updates when completed scan results are detected.</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Summary">
        <p class="text-sm font-semibold text-foreground">{summary?.message ?? "-"}</p>
        <p class="text-xs text-muted-foreground">Providers: {providers.length} · Findings: {findings.length}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="rounded-lg border border-border p-4">
      <p class="mb-3 text-xs text-muted-foreground">Compliance providers</p>
      <div class="grid gap-3 md:grid-cols-2">
        {#if providers.length === 0}
          <div class="rounded-md border border-border p-3 text-sm text-muted-foreground">No providers detected yet.</div>
        {:else}
          {#each providers as provider}
            <div class="rounded-md border border-border p-3">
              <div class="mb-2 flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-foreground">{provider.title}</p>
                {#if provider.status !== "not_installed"}
                  <Badge class="text-white {providerBadgeClass[provider.status]}">
                    {providerBadgeLabel[provider.status]}
                  </Badge>
                {/if}
              </div>
              {#if provider.message}
                <p class="text-xs text-muted-foreground">{provider.message}</p>
              {/if}
              {#if provider.releaseName || provider.namespace}
                <p class="mt-1 text-xs text-muted-foreground">
                  Release: {provider.releaseName ?? "-"} · Namespace: {provider.namespace ?? "-"}
                </p>
              {/if}
              {#if canInstall(provider)}
                <div class="mt-3">
                  <Button
                    size="sm"
                    onclick={() => handleInstall(provider.id, provider.title)}
                    loading={providerAction[provider.id]?.status === "working"}
                    loadingLabel="Installing"
                  >
                    <span>{provider.id === "kube-bench" ? "Run kube-bench Job" : "Install (Helm)"}</span>
                  </Button>
                  {#if providerAction[provider.id]?.status === "error"}
                    <p class="mt-1 text-xs text-rose-600">{providerAction[provider.id]?.message}</p>
                  {/if}
                  {#if provider.id === "kube-bench"}
                    <p class="mt-1 text-xs text-muted-foreground">
                      Runs as a one-time Kubernetes Job.
                    </p>
                  {/if}
                </div>
              {/if}
              {#if provider.id === "kube-bench"}
                <div class="mt-2 space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={viewLatestKubeBenchLogs}
                    loading={kubeBenchLogsLoading}
                    loadingLabel="Loading logs"
                    title={kubeBenchLogsLoading ? "Loading kube-bench logs" : "Load logs from latest kube-bench job"}
                  >
                    <span>View latest kube-bench logs</span>
                  </Button>
                  <p class="text-xs text-muted-foreground">
                    Last scan: {formatDate(latestKubeBenchScanAt)}
                  </p>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
      {#if kubeBenchLogs}
        <div class="mt-4 rounded-md border border-border bg-muted/30 p-3">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs font-semibold text-foreground">{kubeBenchLogsTitle ?? "kube-bench logs"}</p>
            {#if hasJsonLogs()}
              <div class="flex items-center gap-2">
                <select
                  class="rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                  bind:value={kubeBenchLogsView}
                >
                  <option value="report">Report view</option>
                  <option value="raw">Raw JSON</option>
                </select>
                <Button size="sm" variant="outline" onclick={downloadKubeBenchJson}>Download JSON</Button>
              </div>
            {/if}
          </div>
          <pre
            class="min-h-64 max-h-[70vh] resize-y overflow-auto whitespace-pre-wrap rounded border border-border bg-background/40 p-2 text-xs text-muted-foreground"
          >{visibleKubeBenchLogs()}</pre>
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={detailsSeverityFilter}
      >
        <option value="problems">Details: FAIL/WARN only</option>
        <option value="all">Details: all sections</option>
      </select>
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={phaseFilter}
      >
        <option value="all">All phases</option>
        <option value="running">Running</option>
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
        <option value="unknown">Unknown</option>
      </select>
    </div>

    <TableSurface maxHeightClass="">
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>Time</Table.TableHead>
            <Table.TableHead>Provider</Table.TableHead>
            <Table.TableHead>Severity</Table.TableHead>
            <Table.TableHead>Framework</Table.TableHead>
            <Table.TableHead>Control</Table.TableHead>
            <Table.TableHead>Phase</Table.TableHead>
            <Table.TableHead>Message</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {#if filteredFindings.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={7} class="text-center">
                <TableEmptyState message="No findings yet. Run a scan or install a compliance provider." />
              </Table.TableCell>
            </Table.TableRow>
          {:else}
            {#each filteredFindings as finding}
              <Table.TableRow>
                <Table.TableCell>{formatDate(finding.updatedAt)}</Table.TableCell>
                <Table.TableCell>{finding.provider}</Table.TableCell>
                <Table.TableCell>
                  <Badge class="text-white {severityClass[finding.severity] ?? 'bg-slate-500'}">
                    {finding.severity}
                  </Badge>
                </Table.TableCell>
                <Table.TableCell>{finding.framework ?? "-"}</Table.TableCell>
                <Table.TableCell>{finding.control ?? "-"}</Table.TableCell>
                <Table.TableCell>{finding.phase ?? "-"}</Table.TableCell>
                <Table.TableCell class="align-top">
                  <div class="space-y-0.5 text-xs leading-relaxed text-foreground">
                    {#each findingMessageLines(finding) as line, i}
                      <p class={i === 0 ? "font-medium" : "text-muted-foreground"}>{line}</p>
                    {/each}
                  </div>
                  {#if hasDetails(finding)}
                    <details class="mt-2 rounded border border-border bg-muted/20 p-2">
                      <summary class="cursor-pointer text-xs font-medium text-foreground">
                        {detailsSummary(finding)}
                      </summary>
                      {#if finding.details?.controls?.length}
                        <div class="mt-2 max-h-44 space-y-1 overflow-auto text-xs text-muted-foreground">
                          {#each visibleControls(finding) as control}
                            <p>
                              {control.id}: FAIL {control.fail} · WARN {control.warn} · PASS {control.pass}
                              {#if control.desc}
                                · {control.desc}
                              {/if}
                            </p>
                          {/each}
                          {#if visibleControls(finding).length === 0}
                            <p>No FAIL/WARN sections in this result.</p>
                          {/if}
                        </div>
                      {/if}
                    </details>
                  {/if}
                </Table.TableCell>
              </Table.TableRow>
            {/each}
          {/if}
        </Table.TableBody>
      </Table.Table>
    </TableSurface>
  </Card.Content>
</Card.Root>
