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
  import {
    runPreflight,
    type PreflightReport,
    type PreflightCheck,
  } from "$features/compliance-hub/model/preflight";
  import { humanizeComplianceError } from "$features/compliance-hub/model/humanize";
  import {
    KUBESCAPE_FRAMEWORKS,
    KUBE_BENCH_FRAMEWORKS,
  } from "$features/compliance-hub/model/frameworks";
  import {
    complianceHistory,
    appendHistory,
    computeScore,
    type ScanHistoryEntry,
  } from "$features/compliance-hub/model/history";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Download from "@lucide/svelte/icons/download";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type TabKey = "overview" | "findings" | "remediation" | "report";

  const hubState = $derived($complianceHubState[clusterId]);
  const summary = $derived(hubState?.summary ?? null);
  const providers = $derived(hubState?.providers ?? []);
  const findings = $derived(hubState?.findings ?? []);
  const kubescapeInstalled = $derived(
    providers.some((provider) => provider.id === "kubescape" && provider.status === "installed"),
  );
  const kubeBenchProvider = $derived(providers.find((p) => p.id === "kube-bench"));

  let activeTab = $state<TabKey>("overview");
  let refreshing = $state(false);
  let triggeringKubescapeScan = $state(false);
  let runningBoth = $state(false);

  let providerFilter = $state<"all" | "kubescape" | "kube-bench">("all");
  let severityFilter = $state<"all" | "critical" | "high" | "medium" | "low" | "info">("all");
  let phaseFilter = $state<"all" | "running" | "completed" | "failed" | "unknown">("all");
  let frameworkFilter = $state<string>("all");
  let findingsSearch = $state("");

  let selectedFramework = $state<string>("nsa");
  let selectedKubeBenchFramework = $state<string>("cis-node");

  let kubeBenchLogsLoading = $state(false);
  let kubeBenchLogs = $state<string | null>(null);
  let kubeBenchLogsRaw = $state<string | null>(null);
  let kubeBenchLogsTitle = $state<string | null>(null);
  let kubeBenchLastScanAt = $state<string | null>(null);
  let kubeBenchLogsView = $state<"report" | "raw">("report");

  let providerAction = $state<
    Record<string, { status: "idle" | "working" | "error"; message?: string }>
  >({});
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  let refreshRequestId = 0;
  let kubescapeRequestId = 0;
  let installRequestId = 0;
  let logsRequestId = 0;
  const installSession = createConsoleSession();
  let installLabel = $state("Compliance provider");

  let preflight = $state<PreflightReport | null>(null);
  let preflightRunning = $state(false);

  const history = $derived($complianceHistory[clusterId] ?? []);

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

  const humanizedNotice = $derived.by(() => {
    if (!actionNotice || actionNotice.type !== "error") return null;
    return humanizeComplianceError(actionNotice.text);
  });

  // Aggregate totals across all findings
  const overallTotals = $derived.by(() => {
    let pass = 0;
    let fail = 0;
    let warn = 0;
    let info = 0;
    for (const f of findings) {
      const t = f.details?.totals;
      if (t) {
        pass += t.pass;
        fail += t.fail;
        warn += t.warn;
        info += t.info;
      }
    }
    return { pass, fail, warn, info };
  });

  const overallScore = $derived(computeScore(overallTotals));

  const severityCounts = $derived.by(() => {
    const out: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) out[f.severity] = (out[f.severity] ?? 0) + 1;
    return out;
  });

  const previousScore = $derived.by(() => {
    const entry = history.find((h) => h.provider === "kubescape") ?? history[0];
    return entry?.score ?? null;
  });

  const scoreDelta = $derived.by(() => {
    if (previousScore == null || overallScore === 0) return null;
    return overallScore - previousScore;
  });

  const availableFrameworks = $derived.by(() => {
    const set = new Set<string>();
    for (const f of findings) if (f.framework) set.add(f.framework);
    return [...set].sort();
  });

  const filteredFindings = $derived.by(() => {
    let result = findings;
    if (providerFilter !== "all") {
      result = result.filter((f) => f.provider === providerFilter);
    }
    if (severityFilter !== "all") {
      result = result.filter((f) => f.severity === severityFilter);
    }
    if (frameworkFilter !== "all") {
      result = result.filter((f) => f.framework === frameworkFilter);
    }
    if (phaseFilter !== "all") {
      result = result.filter((finding) => {
        const phase = (finding.phase || "").toLowerCase();
        if (phaseFilter === "running") return phase.includes("run") || phase.includes("progress");
        if (phaseFilter === "completed")
          return phase.includes("complete") || phase.includes("done");
        if (phaseFilter === "failed") return phase.includes("fail") || phase.includes("error");
        return !phase || phase === "unknown";
      });
    }
    if (findingsSearch.trim()) {
      const q = findingsSearch.trim().toLowerCase();
      result = result.filter((f) =>
        [f.control, f.message, f.framework, f.namespace, f.resource].some((v) =>
          (v ?? "").toLowerCase().includes(q),
        ),
      );
    }
    return result;
  });

  // Remediation items: surface all FAIL/WARN controls grouped by control.id
  interface RemediationRow {
    controlId: string;
    desc: string;
    fail: number;
    warn: number;
    pass: number;
    source: string;
    remediation?: string;
  }
  const remediationRows = $derived.by(() => {
    const map = new Map<string, RemediationRow>();
    for (const f of findings) {
      for (const c of f.details?.controls ?? []) {
        if (c.fail === 0 && c.warn === 0) continue;
        const key = `${f.provider}::${c.id}`;
        const existing = map.get(key);
        if (existing) {
          existing.fail += c.fail;
          existing.warn += c.warn;
          existing.pass += c.pass;
        } else {
          map.set(key, {
            controlId: c.id,
            desc: c.desc ?? "",
            fail: c.fail,
            warn: c.warn,
            pass: c.pass,
            source: f.provider,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.fail - a.fail);
  });

  function formatDate(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
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

  function toHumanReportFromJson(text: string): string | null {
    const parsed = parseJson(text);
    if (!parsed || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const controls = Array.isArray(root.Controls)
      ? (root.Controls as Array<Record<string, unknown>>)
      : [];
    const totals =
      root.Totals && typeof root.Totals === "object"
        ? (root.Totals as Record<string, unknown>)
        : undefined;
    const oneLine = (value: unknown): string =>
      String(value ?? "")
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? "";
    const testSections = controls.flatMap((control) => {
      const tests = Array.isArray(control.tests)
        ? (control.tests as Array<Record<string, unknown>>)
        : [];
      return tests.map((test) => {
        const results = Array.isArray(test.results)
          ? (test.results as Array<Record<string, unknown>>)
          : [];
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
      for (const problem of section.problems) {
        lines.push(`  - [${problem.status}] ${problem.number}: ${problem.desc}`);
        if (problem.remediation) lines.push(`    Fix: ${problem.remediation}`);
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

  function downloadCombinedReport() {
    const payload = {
      generatedAt: new Date().toISOString(),
      clusterId,
      score: overallScore,
      totals: overallTotals,
      severityCounts,
      providers: providers.map((p) => ({
        id: p.id,
        status: p.status,
        releaseName: p.releaseName ?? null,
        namespace: p.namespace ?? null,
        chartVersion: p.chartVersion ?? null,
      })),
      findings: findings.map((f) => ({
        id: f.id,
        provider: f.provider,
        severity: f.severity,
        framework: f.framework ?? null,
        control: f.control ?? null,
        resource: f.resource ?? null,
        namespace: f.namespace ?? null,
        phase: f.phase ?? null,
        message: f.message,
        totals: f.details?.totals ?? null,
        updatedAt: f.updatedAt,
      })),
      history: history.slice(0, 5),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${clusterId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function jumpToResource(resource: string | undefined, namespace: string | undefined) {
    if (!resource) return;
    const params = new URLSearchParams($page.url.search);
    const parts = resource.split("/");
    const kind = parts.length > 1 ? parts[0].toLowerCase() : "pods";
    const workloadMap: Record<string, string> = {
      pod: "pods",
      deployment: "deployments",
      statefulset: "statefulsets",
      daemonset: "daemonsets",
      replicaset: "replicasets",
      job: "jobs",
      cronjob: "cronjobs",
      service: "services",
      ingress: "ingresses",
      configmap: "configmaps",
      secret: "secrets",
      persistentvolumeclaim: "persistentvolumeclaims",
      serviceaccount: "serviceaccounts",
      role: "roles",
      rolebinding: "rolebindings",
      clusterrole: "clusterroles",
      clusterrolebinding: "clusterrolebindings",
      networkpolicy: "networkpolicies",
    };
    const workload = workloadMap[kind] ?? "pods";
    params.set("workload", workload);
    if (namespace) params.set("namespace", namespace);
    void goto(`?${params.toString()}`, { keepFocus: false });
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
          `Kubescape scan started (framework: ${selectedFramework}).\n` +
          `Namespace: ${result.namespace ?? "kubescape"}\n` +
          `Scan: ${result.scanName ?? "dashboard-manual-*"}`,
      };
      recordHistory("kubescape");
    } finally {
      if (requestId !== kubescapeRequestId || activeClusterId !== clusterId) return;
      triggeringKubescapeScan = false;
    }
  }

  async function runBothScans() {
    if (runningBoth) return;
    runningBoth = true;
    actionNotice = null;
    try {
      const results = await Promise.allSettled([
        kubescapeInstalled
          ? runKubescapeScanNow(clusterId)
          : Promise.resolve({ success: false, error: "Kubescape not installed" }),
        runKubeBenchScanNow(clusterId),
      ]);
      const msgs: string[] = [];
      const ksRes = results[0];
      const kbRes = results[1];
      if (ksRes.status === "fulfilled" && ksRes.value.success) msgs.push("Kubescape: started");
      else if (ksRes.status === "fulfilled") msgs.push(`Kubescape: ${ksRes.value.error}`);
      else msgs.push(`Kubescape: ${ksRes.reason}`);
      if (kbRes.status === "fulfilled" && kbRes.value.success) msgs.push("kube-bench: started");
      else if (kbRes.status === "fulfilled") msgs.push(`kube-bench: ${kbRes.value.error}`);
      else msgs.push(`kube-bench: ${kbRes.reason}`);
      actionNotice = { type: "success", text: msgs.join("\n") };
      recordHistory("kubescape");
      recordHistory("kube-bench");
    } finally {
      runningBoth = false;
    }
  }

  function recordHistory(provider: ScanHistoryEntry["provider"]) {
    const entry: ScanHistoryEntry = {
      ranAt: new Date().toISOString(),
      provider,
      score: overallScore,
      totalFail: overallTotals.fail,
      totalWarn: overallTotals.warn,
      totalPass: overallTotals.pass,
      totalFindings: findings.length,
    };
    appendHistory(clusterId, entry);
  }

  function canInstall(provider: ComplianceProvider): boolean {
    return provider.status === "not_installed";
  }

  async function handleInstall(providerId: ComplianceProviderId, title: string) {
    if (providerAction[providerId]?.status === "working") return;
    const requestId = ++installRequestId;
    const activeClusterId = clusterId;
    providerAction = { ...providerAction, [providerId]: { status: "working" } };
    actionNotice = null;
    installLabel = `Installing ${title}`;
    // Only the helm path streams output; kube-bench uses a K8s Job so the
    // console stays idle for that branch.
    if (providerId !== "kube-bench") installSession.start();

    try {
      if (providerId === "kube-bench") {
        const result = await runKubeBenchScanNow(activeClusterId);
        if (requestId !== installRequestId || activeClusterId !== clusterId) return;
        if (!result.success) {
          const message = result.error?.trim() || `Failed to install ${title}`;
          providerAction = { ...providerAction, [providerId]: { status: "error", message } };
          actionNotice = { type: "error", text: `${title}: ${message}` };
          return;
        }
        providerAction = { ...providerAction, [providerId]: { status: "idle" } };
        actionNotice = {
          type: "success",
          text:
            `${title} job started.\n` +
            `Namespace: ${result.namespace ?? "kube-system"}\n` +
            `Job: ${result.jobName ?? "dashboard-kube-bench-*"}`,
        };
        kubeBenchLastScanAt = new Date().toISOString();
      } else {
        const result = await installComplianceProvider(clusterId, providerId, (chunk) =>
          installSession.append(chunk),
        );
        if (!result.success) {
          const message = result.error?.trim() || `Failed to install ${title}`;
          providerAction = { ...providerAction, [providerId]: { status: "error", message } };
          actionNotice = { type: "error", text: `${title}: ${message}` };
          installSession.fail();
          return;
        }
        providerAction = { ...providerAction, [providerId]: { status: "idle" } };
        actionNotice = { type: "success", text: `${title} installed via Helm.` };
        installSession.succeed();
      }
      await runComplianceHubScan(activeClusterId, { force: true, statusOnly: true });
    } catch (error) {
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const message = error instanceof Error ? error.message : `Failed to install ${title}`;
      providerAction = { ...providerAction, [providerId]: { status: "error", message } };
      actionNotice = { type: "error", text: `${title}: ${message}` };
      if (providerId !== "kube-bench") installSession.fail();
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

  async function doPreflight() {
    if (preflightRunning) return;
    preflightRunning = true;
    try {
      preflight = await runPreflight(clusterId);
    } catch (e) {
      actionNotice = { type: "error", text: (e as Error).message };
    } finally {
      preflightRunning = false;
    }
  }

  function preflightIconColor(status: PreflightCheck["status"]): string {
    return status === "ok"
      ? "text-emerald-400"
      : status === "warn"
        ? "text-amber-400"
        : status === "fail"
          ? "text-rose-400"
          : "text-slate-500";
  }

  const scoreColor = $derived.by(() => {
    if (overallScore >= 80) return "text-emerald-400";
    if (overallScore >= 60) return "text-amber-400";
    if (overallScore >= 40) return "text-orange-400";
    return "text-rose-400";
  });

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    kubescapeRequestId += 1;
    installRequestId += 1;
    logsRequestId += 1;
    preflight = null;
  });

  $effect(() => {
    if (!clusterId) return;
    if (offline) {
      markComplianceHubUnavailable(clusterId, "Compliance checks unavailable: cluster is offline");
      return;
    }
    void runComplianceHubScan(clusterId, { force: false, statusOnly: true });
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold" title="Kubescape and kube-bench unified compliance view">
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
          <Popover.Content class="w-[460px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Two complementary scanners</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <div>
                <p class="font-medium text-foreground">Kubescape - workload posture</p>
                <p>
                  Audits pods, RBAC, NetworkPolicy, Ingress, ServiceAccount, admission controllers
                  against CIS / NSA / MITRE / SOC2.
                </p>
                <p class="italic">
                  Example findings: containers running as root, missing resource limits, dangerous
                  RBAC bindings.
                </p>
              </div>
              <div>
                <p class="font-medium text-foreground">kube-bench - node/control-plane hardening</p>
                <p>
                  Runs the official CIS Kubernetes Benchmark against kubelet config, API server
                  flags, etcd, scheduler, controller-manager.
                </p>
                <p class="italic">
                  Example findings: kubelet anonymous auth enabled, etcd file permissions wrong, API
                  server audit log missing.
                </p>
              </div>
            </div>
            <div class="text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubescape/kubescape"
                target="_blank"
                rel="noreferrer noopener">Kubescape GitHub</a
              >
              -
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/aquasecurity/kube-bench"
                target="_blank"
                rel="noreferrer noopener">kube-bench GitHub</a
              >
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
          disabled={triggeringKubescapeScan || runningBoth}
        >
          <Refresh class="mr-2 h-4 w-4" /> Refresh status
        </Button>
        <Button
          onclick={runKubescapeNow}
          loading={triggeringKubescapeScan}
          loadingLabel="Running"
          disabled={refreshing || !kubescapeInstalled}
          title={kubescapeInstalled
            ? `Run Kubescape against ${selectedFramework}`
            : "Install Kubescape first"}
        >
          <span>Run Kubescape Scan now</span>
        </Button>
        <Button
          variant="outline"
          onclick={runBothScans}
          loading={runningBoth}
          loadingLabel="Running both"
          disabled={refreshing || !kubescapeInstalled}
        >
          Run both
        </Button>
      </div>
    </div>

    <!-- Tab navigation -->
    <div class="flex items-center gap-1 border-b border-border mt-1">
      {#each [{ k: "overview", label: "Overview" }, { k: "findings", label: "Findings" }, { k: "remediation", label: "Remediation" }, { k: "report", label: "Report" }] as tab (tab.k)}
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = tab.k as TabKey)}
        >
          {tab.label}
          {#if tab.k === "findings" && findings.length > 0}
            <span class="ml-1 text-[10px] text-muted-foreground">({findings.length})</span>
          {/if}
          {#if tab.k === "remediation" && remediationRows.length > 0}
            <span class="ml-1 text-[10px] text-rose-400">({remediationRows.length})</span>
          {/if}
        </button>
      {/each}
    </div>
  </Card.Header>
  <Card.Content class="space-y-4">
    {#if actionNotice?.type === "success"}
      <Alert.Root variant="default">
        <Alert.Title>Action completed</Alert.Title>
        <Alert.Description class="whitespace-pre-line">{actionNotice.text}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if actionNotice?.type === "error"}
      <Alert.Root variant="destructive">
        <Alert.Title>{humanizedNotice?.title ?? "Action failed"}</Alert.Title>
        <Alert.Description>
          {#if humanizedNotice?.hint}
            <p class="mb-1">{humanizedNotice.hint}</p>
          {/if}
          <details>
            <summary class="cursor-pointer text-xs opacity-70">Raw error</summary>
            <pre class="mt-1 whitespace-pre-wrap text-xs">{actionNotice.text}</pre>
          </details>
        </Alert.Description>
      </Alert.Root>
    {/if}

    <CommandConsole session={installSession} label={installLabel} />

    {#if activeTab === "overview"}
      {#if !kubescapeInstalled && kubeBenchProvider?.status !== "installed"}
        <div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-2">
          <div class="flex items-start gap-3">
            <ShieldCheck class="h-6 w-6 text-sky-400 shrink-0 mt-0.5" />
            <div class="space-y-2">
              <p class="text-sm font-semibold text-foreground">
                Audit this cluster against recognized benchmarks
              </p>
              <p class="text-xs text-muted-foreground">
                Kubescape and kube-bench are two complementary scanners. Install both for full
                coverage: workload posture + node/control-plane hardening.
              </p>
              <ul class="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                <li>
                  <span class="text-foreground">Kubescape</span>: pods, RBAC, NetworkPolicy,
                  misconfigurations (NSA / MITRE / CIS-v1.23 / SOC2)
                </li>
                <li>
                  <span class="text-foreground">kube-bench</span>: kubelet, API server, etcd,
                  scheduler (CIS Kubernetes Benchmark)
                </li>
              </ul>
              <ol class="text-xs text-muted-foreground list-decimal pl-5 space-y-0.5">
                <li>Run pre-flight to confirm PSA labels, RBAC, no blocking policies</li>
                <li>Install Kubescape (Helm) and run kube-bench (one-shot Job)</li>
                <li>Review Findings tab, filter by severity and framework</li>
                <li>Open Remediation tab for copyable fix commands</li>
              </ol>
              <div class="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  onclick={doPreflight}
                  loading={preflightRunning}
                  loadingLabel="Running preflight"
                >
                  Run pre-flight checks
                </Button>
              </div>
            </div>
          </div>
        </div>
      {/if}

      {#if preflight}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold">Pre-flight checks</p>
            <Badge
              class="text-white {preflight.overall === 'ok'
                ? 'bg-emerald-500'
                : preflight.overall === 'warn'
                  ? 'bg-amber-500'
                  : preflight.overall === 'fail'
                    ? 'bg-rose-500'
                    : 'bg-slate-500'}">{preflight.overall}</Badge
            >
          </div>
          <ul class="space-y-1.5">
            {#each preflight.checks as check (check.id)}
              <li class="flex items-start gap-2 text-xs">
                {#if check.status === "ok"}
                  <CircleCheck class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {:else if check.status === "warn"}
                  <CircleAlert class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {:else if check.status === "fail"}
                  <CircleX class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {:else}
                  <CircleHelp class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {/if}
                <div class="space-y-0.5">
                  <p class="font-medium text-foreground">{check.title}</p>
                  <p class="text-muted-foreground">{check.detail}</p>
                </div>
              </li>
            {/each}
          </ul>
          <p class="text-[10px] text-muted-foreground">
            Ran {new Date(preflight.ranAt).toLocaleString()}
          </p>
        </div>
      {/if}

      <!-- Framework selection -->
      {#if kubescapeInstalled}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold">Kubescape framework</p>
          <p class="text-[11px] text-muted-foreground">
            The operator scans continuously across all configured frameworks. Pick one to filter
            findings in the next tab.
          </p>
          <div class="flex flex-wrap gap-1.5">
            {#each KUBESCAPE_FRAMEWORKS as fw (fw.id)}
              <button
                type="button"
                class="rounded border px-2 py-0.5 text-[11px] transition {selectedFramework ===
                fw.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'}"
                title={fw.description}
                onclick={() => {
                  selectedFramework = fw.id;
                  frameworkFilter = fw.id;
                }}
              >
                {fw.label} <span class="opacity-60">({fw.controls})</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- kube-bench target -->
      {#if kubeBenchProvider?.status === "installed"}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold">kube-bench target</p>
          <div class="flex flex-wrap gap-1.5">
            {#each KUBE_BENCH_FRAMEWORKS as fw (fw.id)}
              <button
                type="button"
                class="rounded border px-2 py-0.5 text-[11px] transition {selectedKubeBenchFramework ===
                fw.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'}"
                title={fw.description}
                onclick={() => (selectedKubeBenchFramework = fw.id)}
              >
                {fw.label} <span class="opacity-60">({fw.controls})</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Severity dashboard -->
      {#if findings.length > 0}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <p class="text-sm font-semibold">Compliance score</p>
            <div class="flex items-center gap-3">
              <span class="text-3xl font-bold font-mono {scoreColor}">{overallScore}</span>
              <span class="text-xs text-muted-foreground">/100</span>
              {#if scoreDelta != null}
                <span
                  class="text-xs {scoreDelta > 0
                    ? 'text-emerald-400'
                    : scoreDelta < 0
                      ? 'text-rose-400'
                      : 'text-muted-foreground'}"
                >
                  {scoreDelta > 0 ? "+" : ""}{scoreDelta} vs previous
                </span>
              {/if}
            </div>
          </div>
          <div class="grid grid-cols-4 gap-2 text-xs">
            <div class="rounded bg-emerald-500/10 border border-emerald-500/30 p-2">
              <p class="text-emerald-400 font-mono">{overallTotals.pass}</p>
              <p class="text-muted-foreground">PASS</p>
            </div>
            <div class="rounded bg-amber-500/10 border border-amber-500/30 p-2">
              <p class="text-amber-400 font-mono">{overallTotals.warn}</p>
              <p class="text-muted-foreground">WARN</p>
            </div>
            <div class="rounded bg-rose-500/10 border border-rose-500/30 p-2">
              <p class="text-rose-400 font-mono">{overallTotals.fail}</p>
              <p class="text-muted-foreground">FAIL</p>
            </div>
            <div class="rounded bg-slate-500/10 border border-slate-500/30 p-2">
              <p class="text-slate-400 font-mono">{overallTotals.info}</p>
              <p class="text-muted-foreground">INFO</p>
            </div>
          </div>

          <p class="text-xs text-muted-foreground">
            Severity breakdown ({findings.length} findings)
          </p>
          <div class="flex h-2 w-full rounded overflow-hidden">
            {#each Object.entries(severityCounts) as [sev, count] (sev)}
              {#if count > 0}
                <div
                  class={severityClass[sev] ?? "bg-slate-500"}
                  style="width: {(count / findings.length) * 100}%"
                  title="{sev}: {count}"
                ></div>
              {/if}
            {/each}
          </div>
          <div class="flex flex-wrap gap-2 text-[10px]">
            {#each Object.entries(severityCounts) as [sev, count] (sev)}
              {#if count > 0}
                <span class="flex items-center gap-1">
                  <span class="h-2 w-2 rounded {severityClass[sev] ?? 'bg-slate-500'}"></span>
                  <span class="capitalize text-muted-foreground">{sev}</span>
                  <span class="font-mono text-foreground">{count}</span>
                </span>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- Status cards -->
      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-lg border border-border p-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Clock4 class="h-4 w-4" /> Last scan
          </div>
          <p class="text-sm font-medium text-foreground">{formatDate(lastScanAt)}</p>
          <p class="text-xs text-muted-foreground">
            Updates when completed scan results are detected.
          </p>
        </div>
        <div class="rounded-lg border border-border p-3">
          <p class="text-xs text-muted-foreground mb-1">Summary</p>
          <p class="text-sm font-semibold text-foreground">{summary?.message ?? "-"}</p>
          <p class="text-xs text-muted-foreground">
            Providers: {providers.length} - Findings: {findings.length}
          </p>
        </div>
      </div>

      <!-- Providers -->
      <div class="rounded-lg border border-border p-4">
        <p class="mb-3 text-xs text-muted-foreground">Compliance providers</p>
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
                    Release: {provider.releaseName ?? "-"} - Namespace: {provider.namespace ?? "-"}
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
                      <span
                        >{provider.id === "kube-bench"
                          ? "Run kube-bench Job"
                          : "Install (Helm)"}</span
                      >
                    </Button>
                    {#if providerAction[provider.id]?.status === "error"}
                      <p class="mt-1 text-xs text-rose-600">
                        {providerAction[provider.id]?.message}
                      </p>
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
                      title={kubeBenchLogsLoading
                        ? "Loading kube-bench logs"
                        : "Load logs from latest kube-bench job"}
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
      </div>

      <!-- Scan history -->
      {#if history.length > 0}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold">Scan history (last {history.length})</p>
          <table class="w-full text-xs">
            <thead class="text-muted-foreground text-left">
              <tr>
                <th class="py-1 font-normal">When</th>
                <th class="py-1 font-normal">Provider</th>
                <th class="py-1 font-normal">Score</th>
                <th class="py-1 font-normal">FAIL</th>
                <th class="py-1 font-normal">WARN</th>
                <th class="py-1 font-normal">PASS</th>
              </tr>
            </thead>
            <tbody>
              {#each history as h}
                <tr class="border-t border-border">
                  <td class="py-1">{formatDate(h.ranAt)}</td>
                  <td class="py-1">{h.provider}</td>
                  <td class="py-1 font-mono">{h.score}</td>
                  <td class="py-1 text-rose-400">{h.totalFail}</td>
                  <td class="py-1 text-amber-400">{h.totalWarn}</td>
                  <td class="py-1 text-emerald-400">{h.totalPass}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

    {#if activeTab === "findings"}
      <div class="flex flex-wrap items-center gap-2">
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={providerFilter}
        >
          <option value="all">Any provider</option>
          <option value="kubescape">Kubescape</option>
          <option value="kube-bench">kube-bench</option>
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={severityFilter}
        >
          <option value="all">Any severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
        {#if availableFrameworks.length > 0}
          <select
            class="h-8 rounded border border-input bg-background px-2 text-xs"
            bind:value={frameworkFilter}
          >
            <option value="all">Any framework</option>
            {#each availableFrameworks as fw}
              <option value={fw}>{fw}</option>
            {/each}
          </select>
        {/if}
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={phaseFilter}
        >
          <option value="all">Any phase</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="unknown">Unknown</option>
        </select>
        <input
          class="h-8 w-[220px] rounded border border-input bg-background px-2 text-xs"
          placeholder="Search control/message..."
          bind:value={findingsSearch}
        />
        <span class="text-xs text-muted-foreground"
          >{filteredFindings.length} of {findings.length}</span
        >
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
                  <TableEmptyState
                    message={findings.length === 0
                      ? "No findings yet. Run a scan or install a compliance provider."
                      : "No findings match the current filter. Clear filters or try a different severity."}
                  />
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
                      <p class="font-medium">{finding.message || "-"}</p>
                      {#if finding.namespace || finding.resource}
                        <p class="text-muted-foreground">
                          {finding.namespace ? `ns: ${finding.namespace}` : ""}
                          {#if finding.resource}
                            {finding.namespace ? " / " : ""}
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 text-primary hover:underline"
                              onclick={() => jumpToResource(finding.resource, finding.namespace)}
                              title="Jump to resource page"
                            >
                              {finding.resource}
                              <ExternalLink class="h-3 w-3" />
                            </button>
                          {/if}
                        </p>
                      {/if}
                    </div>
                  </Table.TableCell>
                </Table.TableRow>
              {/each}
            {/if}
          </Table.TableBody>
        </Table.Table>
      </TableSurface>
    {/if}

    {#if activeTab === "remediation"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          FAIL/WARN controls grouped by control id across all providers. Copy kubectl-describe
          command to inspect the offending resource.
        </p>
        {#if remediationRows.length === 0}
          <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
            No remediation items. Either no FAIL/WARN yet, or no scan has been run.
          </div>
        {:else}
          <div class="space-y-2">
            {#each remediationRows as r (r.source + "::" + r.controlId)}
              <div class="rounded border border-border p-3 text-xs space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-foreground">{r.controlId}</span>
                  <span class="text-[10px] text-slate-500">{r.source}</span>
                  <span class="text-rose-400 font-mono">FAIL {r.fail}</span>
                  <span class="text-amber-400 font-mono">WARN {r.warn}</span>
                  <span class="text-emerald-400 font-mono">PASS {r.pass}</span>
                </div>
                {#if r.desc}
                  <p class="text-muted-foreground">{r.desc}</p>
                {/if}
                <div class="flex flex-wrap gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 text-[10px]"
                    onclick={() =>
                      copyText(
                        `kubectl get events -A --field-selector reason=${r.controlId}`,
                        "events command",
                      )}
                  >
                    <Copy class="mr-1 h-3 w-3" /> Copy events query
                  </Button>
                  {#if r.source === "kube-bench"}
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-6 text-[10px]"
                      onclick={() =>
                        copyText(
                          `# CIS control ${r.controlId}\n# See kube-bench docs for the exact remediation steps.\n# ${r.desc}`,
                          "remediation template",
                        )}
                    >
                      <Copy class="mr-1 h-3 w-3" /> Copy CIS note
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if activeTab === "report"}
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onclick={downloadCombinedReport}
            disabled={findings.length === 0}
          >
            <Download class="mr-1 h-3.5 w-3.5" /> Download combined report
          </Button>
          {#if kubeBenchLogsRaw && hasJsonLogs()}
            <Button size="sm" variant="outline" onclick={downloadKubeBenchJson}>
              <Download class="mr-1 h-3.5 w-3.5" /> Download kube-bench JSON
            </Button>
          {/if}
        </div>

        {#if kubeBenchLogs}
          <div class="rounded-md border border-border bg-muted/30 p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-semibold text-foreground">
                {kubeBenchLogsTitle ?? "kube-bench logs"}
              </p>
              {#if hasJsonLogs()}
                <select
                  class="rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                  bind:value={kubeBenchLogsView}
                >
                  <option value="report">Report view</option>
                  <option value="raw">Raw JSON</option>
                </select>
              {/if}
            </div>
            <pre
              class="min-h-64 max-h-[70vh] resize-y overflow-auto whitespace-pre-wrap rounded border border-border bg-background/40 p-2 text-xs text-muted-foreground">{visibleKubeBenchLogs()}</pre>
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">
            No kube-bench logs loaded yet. Open the Overview tab and click "View latest kube-bench
            logs".
          </p>
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
