<script lang="ts">
  import {
    installTrivyProvider,
    markTrivyHubUnavailable,
    runLocalTrivyK8sScan,
    runTrivyHubScan,
    runTrivyScanNow,
    trivyHubReports,
    trivyHubState,
    type TrivyProviderId,
    type TrivyProviderStatus,
  } from "$features/trivy-hub";
  import { humanizeTrivyError } from "$features/trivy-hub/model/humanize";
  import {
    runPreflight,
    type PreflightReport,
    type PreflightCheck,
  } from "$features/trivy-hub/model/preflight";
  import {
    trivyHistory,
    appendHistory,
    type TrivyHistoryEntry,
  } from "$features/trivy-hub/model/history";
  import * as Alert from "$shared/ui/alert";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Download from "@lucide/svelte/icons/download";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FileText from "@lucide/svelte/icons/file-text";
  import * as Popover from "$shared/ui/popover";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { uninstallHelmRelease } from "$shared/api/helm";
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

  type TabKey = "overview" | "vulnerabilities" | "misconfigs" | "secrets" | "sbom" | "report";

  type ScanSource = "operator" | "local";

  interface VulnItem {
    namespace: string;
    resource: string;
    image: string;
    vulnerabilityID: string;
    severity: string;
    pkgName: string;
    installedVersion: string;
    fixedVersion: string;
    title: string;
    primaryLink: string;
    score: number;
    source: ScanSource;
  }

  interface MisconfigItem {
    namespace: string;
    resource: string;
    checkID: string;
    severity: string;
    category: string;
    title: string;
    description: string;
    messages: string[];
    source: ScanSource;
  }

  interface SecretItem {
    namespace: string;
    resource: string;
    ruleID: string;
    severity: string;
    category: string;
    title: string;
    target: string;
    match: string;
    source: ScanSource;
  }

  interface SbomItem {
    namespace: string;
    resource: string;
    image: string;
    componentCount: number;
    updatedAt: string;
  }

  const hubState = $derived($trivyHubState[clusterId]);
  const reportRaw = $derived($trivyHubReports[clusterId] ?? null);
  const summary = $derived(hubState?.summary ?? null);
  const providers = $derived(hubState?.providers ?? []);
  const trivyInstalled = $derived(
    providers.some((p) => p.id === "trivy-operator" && p.status === "installed"),
  );
  const trivyProvider = $derived(providers.find((p) => p.id === "trivy-operator"));
  const runScanDisabledReason = $derived.by(() => {
    if (scanning) return "Trivy scan is already running";
    if (!trivyInstalled) return "Install Trivy Operator first to enable scan";
    return "Run Trivy scan now";
  });
  const lastScanAt = $derived.by(() => {
    if (!reportRaw) return null;
    const parsed = parseJson(reportRaw) as { generatedAt?: unknown } | null;
    return typeof parsed?.generatedAt === "string" ? parsed.generatedAt : null;
  });

  let activeTab = $state<TabKey>("overview");
  let refreshing = $state(false);
  let scanning = $state(false);
  let reportView = $state<"cards" | "raw">("cards");
  let providerAction = $state<
    Record<string, { status: "idle" | "working" | "error"; message?: string }>
  >({});
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  let refreshRequestId = 0;
  let installRequestId = 0;
  let scanRequestId = 0;
  const installSession = createConsoleSession();
  let installLabel = $state("Trivy");
  // Dedicated session for `trivy k8s` local scans so a running scan does
  // not clobber install/uninstall transcripts.
  const localScanSession = createConsoleSession();
  let localScanning = $state(false);

  let preflight = $state<PreflightReport | null>(null);
  let preflightRunning = $state(false);

  let vulns = $state<VulnItem[]>([]);
  let vulnsLoading = $state(false);
  let vulnsError = $state<string | null>(null);
  // Guards the auto-fetch effect from re-firing when the fetch returns
  // zero items. Without this the reassignment `vulns = []` would re-run
  // the effect (vulns identity changed), and since the condition is
  // still `vulns.length === 0`, kubectl would be spawned in an
  // infinite loop - freezing the app.
  let vulnsFetched = $state(false);
  let vulnSeverityFilter = $state<"all" | "critical" | "high" | "medium" | "low" | "unknown">(
    "all",
  );
  let vulnFixableOnly = $state(false);
  let vulnSearch = $state("");

  let misconfigs = $state<MisconfigItem[]>([]);
  let misconfigsLoading = $state(false);
  let misconfigsError = $state<string | null>(null);
  let misconfigsFetched = $state(false);
  let misconfigSeverityFilter = $state<"all" | "critical" | "high" | "medium" | "low" | "unknown">(
    "all",
  );
  let misconfigSearch = $state("");

  let secrets = $state<SecretItem[]>([]);
  let secretsLoading = $state(false);
  let secretsError = $state<string | null>(null);
  let secretsFetched = $state(false);
  let secretSearch = $state("");

  let sboms = $state<SbomItem[]>([]);
  let sbomsLoading = $state(false);
  let sbomsFetched = $state(false);

  // Render caps for large datasets. 842+ vulnerability rows mount far too
  // slowly if every row includes a bits-ui <Button>; cap the initial
  // render and let the user paginate. Reset when switching clusters or
  // when the filters narrow the list.
  const PAGE_SIZE = 100;
  let vulnsRenderLimit = $state(PAGE_SIZE);
  let misconfigsRenderLimit = $state(PAGE_SIZE);
  let secretsRenderLimit = $state(PAGE_SIZE);

  let uninstalling = $state(false);
  let fetchingLogs = $state(false);
  let dbStatus = $state<{ updatedAt?: string; version?: string } | null>(null);

  const history = $derived($trivyHistory[clusterId] ?? []);

  const summaryBadgeClass: Record<string, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    unavailable: "bg-slate-500",
  };

  const providerBadgeClass: Record<TrivyProviderStatus, string> = {
    installed: "bg-emerald-500",
    not_installed: "bg-amber-500",
    error: "bg-rose-600",
  };

  const severityClass: Record<string, string> = {
    critical: "bg-rose-700",
    high: "bg-rose-600",
    medium: "bg-amber-500",
    low: "bg-yellow-500",
    unknown: "bg-slate-500",
  };

  const severityTextClass: Record<string, string> = {
    critical: "text-rose-400",
    high: "text-orange-400",
    medium: "text-amber-400",
    low: "text-yellow-400",
    unknown: "text-slate-400",
  };

  const humanizedNotice = $derived.by(() => {
    if (!actionNotice || actionNotice.type !== "error") return null;
    return humanizeTrivyError(actionNotice.text);
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

  function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  }
  function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
  }

  function hasJsonReport(): boolean {
    return Boolean(reportRaw && parseJson(reportRaw));
  }

  const parsedReport = $derived.by(() => {
    if (!reportRaw) return null;
    return parseJson(reportRaw) as {
      generatedAt?: string;
      summary?: {
        providersInstalled?: number;
        findings?: number;
        errors?: number;
        severity?: Record<string, number>;
        checks?: { failed?: number; passed?: number; total?: number };
      };
      providers?: Array<{
        id?: string;
        status?: string;
        namespace?: string | null;
        releaseName?: string | null;
      }>;
      resources?: Array<{
        resource?: string;
        available?: boolean;
        count?: number;
        details?: {
          namespaces?: string[];
          sampleResources?: string[];
          severity?: Record<string, number>;
          checks?: { failed?: number; passed?: number; total?: number };
        };
      }>;
      errors?: string[];
    } | null;
  });

  function downloadReportJson() {
    if (!reportRaw) return;
    const blob = new Blob([reportRaw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trivy-scan-report.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCombinedReport() {
    const payload = {
      generatedAt: new Date().toISOString(),
      clusterId,
      vulnerabilities: {
        total: vulns.length,
        bySeverity: severityCountsFromVulns,
        fixable: vulns.filter((v) => v.fixedVersion).length,
        items: vulns,
      },
      misconfigs: {
        total: misconfigs.length,
        bySeverity: severityCountsFromMisconfigs,
        items: misconfigs,
      },
      exposedSecrets: {
        total: secrets.length,
        items: secrets,
      },
      sbomReports: sboms,
      providers: providers.map((p) => ({
        id: p.id,
        status: p.status,
        releaseName: p.releaseName ?? null,
        namespace: p.namespace ?? null,
        chartVersion: p.chartVersion ?? null,
      })),
      history: history.slice(0, 5),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trivy-report-${clusterId}-${Date.now()}.json`;
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

  function extractWorkloadFromReportName(reportName: string): { kind: string; name: string } {
    // Trivy report names are typically: "<kind>-<name>" (e.g. "pod-nginx-xxx", "replicaset-foo-abc")
    const parts = reportName.split("-");
    if (parts.length < 2) return { kind: "pod", name: reportName };
    return { kind: parts[0], name: parts.slice(1).join("-") };
  }

  function jumpToResource(kind: string, namespace: string | undefined) {
    const params = new URLSearchParams($page.url.search);
    const map: Record<string, string> = {
      pod: "pods",
      deployment: "deployments",
      statefulset: "statefulsets",
      daemonset: "daemonsets",
      replicaset: "replicasets",
      job: "jobs",
      cronjob: "cronjobs",
      service: "services",
      configmap: "configmaps",
      secret: "secrets",
      serviceaccount: "serviceaccounts",
      role: "roles",
      rolebinding: "rolebindings",
      clusterrole: "clusterroles",
      clusterrolebinding: "clusterrolebindings",
    };
    const workload = map[kind.toLowerCase()] ?? "pods";
    params.set("workload", workload);
    if (namespace) params.set("namespace", namespace);
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function copySetImage(resource: string, image: string, fixedVersion: string) {
    const [kind, ...nameParts] = resource.split("-");
    const name = nameParts.join("-");
    const [imagePath] = image.split(":");
    const cmd = `kubectl set image ${kind.toLowerCase()}/${name} <container>=${imagePath}:${fixedVersion}`;
    copyText(cmd, "set-image command");
  }

  function runNow() {
    if (!clusterId || refreshing) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    refreshing = true;
    actionNotice = null;
    void runTrivyHubScan(activeClusterId, { force: true, statusOnly: true }).finally(() => {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshing = false;
    });
  }

  function canInstall(providerId: TrivyProviderId, status: TrivyProviderStatus): boolean {
    return status === "not_installed" && providerId === "trivy-operator";
  }

  async function handleInstall(providerId: TrivyProviderId, title: string) {
    if (providerAction[providerId]?.status === "working") return;
    const requestId = ++installRequestId;
    const activeClusterId = clusterId;
    providerAction = { ...providerAction, [providerId]: { status: "working" } };
    actionNotice = null;
    installLabel = `Installing ${title}`;
    installSession.start();
    try {
      const result = await installTrivyProvider(activeClusterId, providerId, (chunk) =>
        installSession.append(chunk),
      );
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        const message = result.error?.trim() || `Failed to install ${title}`;
        providerAction = { ...providerAction, [providerId]: { status: "error", message } };
        actionNotice = { type: "error", text: `${title}: ${message}` };
        installSession.fail();
        return;
      }
      providerAction = { ...providerAction, [providerId]: { status: "idle" } };
      actionNotice = {
        type: "success",
        text: `${title} installed via Helm. First scan may take 10-15 min while CVE DB downloads.`,
      };
      installSession.succeed();
      await runTrivyHubScan(activeClusterId, { force: true });
    } catch (error) {
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const message = error instanceof Error ? error.message : `Failed to install ${title}`;
      providerAction = { ...providerAction, [providerId]: { status: "error", message } };
      actionNotice = { type: "error", text: `${title}: ${message}` };
      installSession.fail();
    }
  }

  async function runScan() {
    if (!clusterId || scanning) return;
    const requestId = ++scanRequestId;
    const activeClusterId = clusterId;
    scanning = true;
    actionNotice = null;
    try {
      const result = await runTrivyScanNow(activeClusterId);
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        actionNotice = { type: "error", text: result.error?.trim() || "Failed to run Trivy scan" };
        return;
      }
      reportView = "cards";
      actionNotice = { type: "success", text: "Trivy scan completed." };
      // Invalidate per-tab caches so other tabs re-fetch on next visit.
      misconfigsFetched = false;
      secretsFetched = false;
      sbomsFetched = false;
      void fetchVulns();
      recordHistory();
    } finally {
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      scanning = false;
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

  /**
   * Ad-hoc scan via the bundled `trivy` binary. Merges results alongside
   * any operator-produced rows in the same tables - every item carries
   * its own `source` so the badge in the UI makes it clear which scan
   * produced it. Local findings replace any previous local findings on
   * each run; operator rows are left untouched.
   */
  async function runLocalScan() {
    if (!clusterId || localScanning) return;
    localScanning = true;
    localScanSession.start();
    try {
      const result = await runLocalTrivyK8sScan(clusterId, localScanSession);
      if (!result.success) {
        actionNotice = {
          type: "error",
          text: result.error?.trim() || "Local trivy scan failed",
        };
        localScanSession.fail();
        return;
      }
      // Keep operator rows, replace local rows.
      vulns = [...vulns.filter((v) => v.source !== "local"), ...result.vulns].sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity),
      );
      misconfigs = [...misconfigs.filter((m) => m.source !== "local"), ...result.misconfigs].sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity),
      );
      secrets = [...secrets.filter((s) => s.source !== "local"), ...result.secrets].sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity),
      );
      // Mark the operator-backed tabs as fetched so the auto-fetch effect
      // does not overwrite the combined rows on the next tab switch.
      vulnsFetched = true;
      misconfigsFetched = true;
      secretsFetched = true;
      actionNotice = {
        type: "success",
        text: `Local scan found ${result.vulns.length} vulnerabilities, ${result.misconfigs.length} misconfigs, ${result.secrets.length} secrets.`,
      };
      localScanSession.succeed();
    } catch (e) {
      actionNotice = { type: "error", text: (e as Error).message };
      localScanSession.fail();
    } finally {
      localScanning = false;
    }
  }

  async function fetchVulns() {
    if (vulnsLoading || !trivyInstalled) return;
    vulnsLoading = true;
    vulnsError = null;
    try {
      const res = await kubectlRawArgsFront(["get", "vulnerabilityreports", "-A", "-o", "json"], {
        clusterId,
      });
      if (res.errors || res.code !== 0) {
        vulnsError = res.errors || res.output || "Failed to fetch vulnerability reports";
        return;
      }
      const parsed = parseJson(res.output) as { items?: unknown[] } | null;
      const collected: VulnItem[] = [];
      for (const item of asArray(parsed?.items)) {
        const m = asRecord(asRecord(item).metadata);
        const labels = asRecord(m.labels);
        const r = asRecord(asRecord(item).report);
        const artifact = asRecord(r.artifact);
        const imageName = [String(artifact.repository ?? ""), String(artifact.tag ?? "")]
          .filter(Boolean)
          .join(":");
        const resource =
          String(labels["trivy-operator.resource.kind"] ?? "") +
          "-" +
          String(labels["trivy-operator.resource.name"] ?? "");
        for (const v of asArray(r.vulnerabilities)) {
          const vv = asRecord(v);
          const cvss = asRecord(vv.cvss);
          const nvd = asRecord(cvss.nvd);
          collected.push({
            namespace: String(m.namespace ?? ""),
            resource: resource.trim() === "-" ? String(m.name ?? "") : resource,
            image: imageName,
            vulnerabilityID: String(vv.vulnerabilityID ?? ""),
            severity: String(vv.severity ?? "UNKNOWN").toLowerCase(),
            pkgName: String(vv.resource ?? ""),
            installedVersion: String(vv.installedVersion ?? ""),
            fixedVersion: String(vv.fixedVersion ?? ""),
            title: String(vv.title ?? ""),
            primaryLink: String(vv.primaryLink ?? ""),
            score: Number(nvd.V3Score ?? cvss.V3Score ?? 0),
            source: "operator",
          });
        }
      }
      vulns = collected.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    } catch (e) {
      vulnsError = (e as Error).message;
    } finally {
      vulnsLoading = false;
      vulnsFetched = true;
    }
  }

  async function fetchMisconfigs() {
    if (misconfigsLoading || !trivyInstalled) return;
    misconfigsLoading = true;
    misconfigsError = null;
    try {
      const [ns, cluster] = await Promise.all([
        kubectlRawArgsFront(["get", "configauditreports", "-A", "-o", "json"], { clusterId }),
        kubectlRawArgsFront(["get", "clusterconfigauditreports", "-o", "json"], { clusterId }),
      ]);
      const collected: MisconfigItem[] = [];
      const ingest = (res: typeof ns) => {
        if (res.errors || res.code !== 0) return;
        const parsed = parseJson(res.output) as { items?: unknown[] } | null;
        for (const item of asArray(parsed?.items)) {
          const m = asRecord(asRecord(item).metadata);
          const r = asRecord(asRecord(item).report);
          for (const c of asArray(r.checks)) {
            const cc = asRecord(c);
            if (cc.success === true) continue;
            collected.push({
              namespace: String(m.namespace ?? ""),
              resource: String(m.name ?? ""),
              checkID: String(cc.checkID ?? cc.id ?? ""),
              severity: String(cc.severity ?? "UNKNOWN").toLowerCase(),
              category: String(cc.category ?? ""),
              title: String(cc.title ?? ""),
              description: String(cc.description ?? ""),
              messages: asArray(cc.messages).map((x) => String(x ?? "")),
              source: "operator",
            });
          }
        }
      };
      ingest(ns);
      ingest(cluster);
      misconfigs = collected.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      if ((ns.errors || ns.code !== 0) && (cluster.errors || cluster.code !== 0)) {
        misconfigsError = (ns.errors || ns.output || "Failed to fetch misconfigs").toString();
      }
    } catch (e) {
      misconfigsError = (e as Error).message;
    } finally {
      misconfigsLoading = false;
      misconfigsFetched = true;
    }
  }

  async function fetchSecrets() {
    if (secretsLoading || !trivyInstalled) return;
    secretsLoading = true;
    secretsError = null;
    try {
      const res = await kubectlRawArgsFront(["get", "exposedsecretreports", "-A", "-o", "json"], {
        clusterId,
      });
      if (res.errors || res.code !== 0) {
        secretsError = res.errors || res.output || "Failed to fetch exposed secret reports";
        return;
      }
      const parsed = parseJson(res.output) as { items?: unknown[] } | null;
      const collected: SecretItem[] = [];
      for (const item of asArray(parsed?.items)) {
        const m = asRecord(asRecord(item).metadata);
        const r = asRecord(asRecord(item).report);
        for (const s of asArray(r.secrets)) {
          const ss = asRecord(s);
          collected.push({
            namespace: String(m.namespace ?? ""),
            resource: String(m.name ?? ""),
            ruleID: String(ss.ruleID ?? ""),
            severity: String(ss.severity ?? "UNKNOWN").toLowerCase(),
            category: String(ss.category ?? ""),
            title: String(ss.title ?? ""),
            target: String(ss.target ?? ""),
            match: String(ss.match ?? ""),
            source: "operator",
          });
        }
      }
      secrets = collected.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    } catch (e) {
      secretsError = (e as Error).message;
    } finally {
      secretsLoading = false;
      secretsFetched = true;
    }
  }

  async function fetchSboms() {
    if (sbomsLoading || !trivyInstalled) return;
    sbomsLoading = true;
    try {
      const res = await kubectlRawArgsFront(["get", "sbomreports", "-A", "-o", "json"], {
        clusterId,
      });
      if (res.errors || res.code !== 0) return;
      const parsed = parseJson(res.output) as { items?: unknown[] } | null;
      const collected: SbomItem[] = [];
      for (const item of asArray(parsed?.items)) {
        const m = asRecord(asRecord(item).metadata);
        const r = asRecord(asRecord(item).report);
        const artifact = asRecord(r.artifact);
        const components = asArray(asRecord(r.components).components);
        collected.push({
          namespace: String(m.namespace ?? ""),
          resource: String(m.name ?? ""),
          image: `${String(artifact.repository ?? "")}${artifact.tag ? ":" + String(artifact.tag) : ""}`,
          componentCount: components.length,
          updatedAt: String(m.creationTimestamp ?? ""),
        });
      }
      sboms = collected;
    } finally {
      sbomsLoading = false;
      sbomsFetched = true;
    }
  }

  async function fetchDbStatus() {
    if (!trivyInstalled || !trivyProvider?.namespace) return;
    try {
      const res = await kubectlRawArgsFront(
        [
          "get",
          "configmap",
          "trivy-operator-trivy-config",
          "-n",
          trivyProvider.namespace,
          "-o",
          "json",
        ],
        { clusterId },
      );
      if (res.code === 0 && !res.errors) {
        const parsed = parseJson(res.output) as { data?: Record<string, string> } | null;
        const data = parsed?.data ?? {};
        dbStatus = {
          updatedAt: data["trivy.dbRepositoryInsecure"] ?? data["trivy.dbUpdatedAt"],
          version: data["trivy.version"],
        };
      }
    } catch {
      // ignore
    }
  }

  async function copyLogsCommand() {
    const ns = trivyProvider?.namespace ?? "trivy-system";
    const cmd = `kubectl logs -n ${ns} deployment/trivy-operator --tail=200 -f`;
    copyText(cmd, "kubectl logs command");
  }

  async function fetchRecentLogs() {
    if (fetchingLogs || !trivyProvider?.namespace) return;
    fetchingLogs = true;
    try {
      const res = await kubectlRawArgsFront(
        ["logs", "-n", trivyProvider.namespace, "deployment/trivy-operator", "--tail=100"],
        { clusterId },
      );
      if (res.errors || res.code !== 0) {
        toast.error(`Logs failed: ${res.errors || res.output}`);
        return;
      }
      copyText(res.output || "(empty)", "recent trivy-operator logs (100 lines)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      fetchingLogs = false;
    }
  }

  async function doUninstall() {
    if (!trivyProvider?.releaseName || !trivyProvider.namespace) return;
    if (
      !confirm(
        `Uninstall Trivy Operator release '${trivyProvider.releaseName}' from namespace '${trivyProvider.namespace}'? Reports may be deleted.`,
      )
    )
      return;
    uninstalling = true;
    try {
      const result = await uninstallHelmRelease(clusterId, {
        releaseName: trivyProvider.releaseName,
        namespace: trivyProvider.namespace,
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Uninstall failed" };
        return;
      }
      actionNotice = {
        type: "success",
        text: "Trivy Operator uninstalled. Refresh status to confirm.",
      };
      await runTrivyHubScan(clusterId, { force: true });
    } catch (e) {
      actionNotice = { type: "error", text: (e as Error).message };
    } finally {
      uninstalling = false;
    }
  }

  function severityRank(s: string): number {
    const m: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, unknown: 1 };
    return m[s.toLowerCase()] ?? 0;
  }

  const severityCountsFromVulns = $derived.by(() => {
    const out: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    for (const v of vulns) out[v.severity] = (out[v.severity] ?? 0) + 1;
    return out;
  });

  const severityCountsFromMisconfigs = $derived.by(() => {
    const out: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    for (const m of misconfigs) out[m.severity] = (out[m.severity] ?? 0) + 1;
    return out;
  });

  const fixableVulns = $derived(vulns.filter((v) => v.fixedVersion).length);

  const filteredVulns = $derived.by(() => {
    let result = vulns;
    if (vulnSeverityFilter !== "all")
      result = result.filter((v) => v.severity === vulnSeverityFilter);
    if (vulnFixableOnly) result = result.filter((v) => v.fixedVersion);
    if (vulnSearch.trim()) {
      const q = vulnSearch.trim().toLowerCase();
      result = result.filter((v) =>
        [v.vulnerabilityID, v.pkgName, v.namespace, v.resource, v.image, v.title].some((s) =>
          s.toLowerCase().includes(q),
        ),
      );
    }
    return result;
  });

  const filteredMisconfigs = $derived.by(() => {
    let result = misconfigs;
    if (misconfigSeverityFilter !== "all")
      result = result.filter((m) => m.severity === misconfigSeverityFilter);
    if (misconfigSearch.trim()) {
      const q = misconfigSearch.trim().toLowerCase();
      result = result.filter((m) =>
        [m.checkID, m.category, m.title, m.description, m.namespace, m.resource].some((s) =>
          s.toLowerCase().includes(q),
        ),
      );
    }
    return result;
  });

  const filteredSecrets = $derived.by(() => {
    if (!secretSearch.trim()) return secrets;
    const q = secretSearch.trim().toLowerCase();
    return secrets.filter((s) =>
      [s.ruleID, s.category, s.title, s.namespace, s.resource, s.target].some((x) =>
        x.toLowerCase().includes(q),
      ),
    );
  });

  function recordHistory() {
    const entry: TrivyHistoryEntry = {
      ranAt: new Date().toISOString(),
      totalVulns: vulns.length,
      critical: severityCountsFromVulns.critical,
      high: severityCountsFromVulns.high,
      medium: severityCountsFromVulns.medium,
      low: severityCountsFromVulns.low,
      fixable: fixableVulns,
      misconfigs: misconfigs.length,
      exposedSecrets: secrets.length,
    };
    appendHistory(clusterId, entry);
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

  const nvdUrl = (cveId: string) =>
    cveId.startsWith("CVE-") ? `https://nvd.nist.gov/vuln/detail/${cveId}` : "";
  const avdUrl = (checkId: string) => {
    if (checkId.startsWith("AVD-"))
      return `https://avd.aquasec.com/misconfig/${checkId.toLowerCase()}`;
    if (checkId.startsWith("KSV") || checkId.startsWith("KCV"))
      return `https://avd.aquasec.com/misconfig/ksv/${checkId.toLowerCase()}`;
    return "";
  };

  const previousCritical = $derived.by(() => {
    const prev = history[1];
    return prev?.critical ?? null;
  });

  const criticalDelta = $derived.by(() => {
    if (previousCritical == null || severityCountsFromVulns.critical == null) return null;
    return severityCountsFromVulns.critical - previousCritical;
  });

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    installRequestId += 1;
    scanRequestId += 1;
    preflight = null;
    vulns = [];
    misconfigs = [];
    secrets = [];
    sboms = [];
    vulnsFetched = false;
    misconfigsFetched = false;
    secretsFetched = false;
    sbomsFetched = false;
    vulnsRenderLimit = PAGE_SIZE;
    misconfigsRenderLimit = PAGE_SIZE;
    secretsRenderLimit = PAGE_SIZE;
  });

  // Reset pagination whenever the user narrows the list via filters, so
  // they always start from page one for the new query.
  $effect(() => {
    vulnSeverityFilter;
    vulnFixableOnly;
    vulnSearch;
    vulnsRenderLimit = PAGE_SIZE;
  });
  $effect(() => {
    misconfigSeverityFilter;
    misconfigSearch;
    misconfigsRenderLimit = PAGE_SIZE;
  });
  $effect(() => {
    secretSearch;
    secretsRenderLimit = PAGE_SIZE;
  });

  $effect(() => {
    if (!clusterId) return;
    if (offline) {
      markTrivyHubUnavailable(clusterId, "Trivy integration unavailable: cluster is offline");
      return;
    }
    void runTrivyHubScan(clusterId, { force: false, statusOnly: true });
  });

  $effect(() => {
    if (trivyInstalled && !dbStatus) void fetchDbStatus();
  });

  // Auto-fetch per-tab once on first visit. Gated on a *Fetched flag
  // rather than `*.length === 0` so an empty result set does not cause
  // the effect to re-fire in a loop (reassigning `vulns = []` mutates
  // identity and would otherwise spawn kubectl forever).
  $effect(() => {
    if (activeTab === "vulnerabilities" && !vulnsFetched && !vulnsLoading && trivyInstalled) {
      void fetchVulns();
    }
    if (activeTab === "misconfigs" && !misconfigsFetched && !misconfigsLoading && trivyInstalled) {
      void fetchMisconfigs();
    }
    if (activeTab === "secrets" && !secretsFetched && !secretsLoading && trivyInstalled) {
      void fetchSecrets();
    }
    if (activeTab === "sbom" && !sbomsFetched && !sbomsLoading && trivyInstalled) {
      void fetchSboms();
    }
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Trivy Operator - vulnerability, misconfig, secret, and SBOM scans"
        >
          Trivy
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
              aria-label="Trivy info"
              title="About Trivy Operator"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[460px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">What Trivy Operator scans</p>
            <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
              <li>
                <span class="text-foreground">CVEs in container images</span> - OS packages, language
                deps, with fixedVersion guidance
              </li>
              <li>
                <span class="text-foreground">Kubernetes misconfigurations</span> - pod security, network
                policy, RBAC (AVD codes)
              </li>
              <li>
                <span class="text-foreground">Exposed secrets in images</span> - AWS keys, JWT, SSH keys,
                passwords hard-coded in layers
              </li>
              <li>
                <span class="text-foreground">SBOM reports</span> - full bill of materials per workload
                image
              </li>
              <li>
                <span class="text-foreground">RBAC assessments</span> - dangerous role bindings
              </li>
            </ul>
            <p class="text-xs text-muted-foreground">
              Reports surface as Kubernetes CRDs; this panel reads them live via kubectl.
            </p>
            <a
              class="text-xs text-primary underline-offset-4 hover:underline"
              href="https://github.com/aquasecurity/trivy-operator"
              target="_blank"
              rel="noreferrer noopener"
            >
              Trivy Operator GitHub
            </a>
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
          disabled={!trivyInstalled}
          title={runScanDisabledReason}
        >
          <span>Run Trivy scan</span>
        </Button>
        <Button
          variant="outline"
          onclick={runLocalScan}
          loading={localScanning}
          loadingLabel="Scanning"
          title="Ad-hoc scan with the bundled trivy binary - no cluster changes needed"
        >
          <span>Quick scan (local)</span>
        </Button>
        {#if trivyInstalled}
          <Button
            variant="outline"
            onclick={fetchRecentLogs}
            loading={fetchingLogs}
            loadingLabel="Fetching"
          >
            <FileText class="mr-2 h-4 w-4" /> Copy recent logs
          </Button>
          <Button variant="outline" onclick={copyLogsCommand}>
            <Copy class="mr-2 h-4 w-4" /> Stream logs cmd
          </Button>
          <Button
            variant="destructive"
            onclick={doUninstall}
            loading={uninstalling}
            loadingLabel="Uninstalling"
          >
            <Trash2 class="mr-2 h-4 w-4" /> Uninstall
          </Button>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-1 border-b border-border mt-1">
      {#each [{ k: "overview", label: "Overview" }, { k: "vulnerabilities", label: "Vulnerabilities" }, { k: "misconfigs", label: "Misconfigurations" }, { k: "secrets", label: "Exposed Secrets" }, { k: "sbom", label: "SBOM" }, { k: "report", label: "Report" }] as tab (tab.k)}
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = tab.k as TabKey)}
        >
          {tab.label}
          {#if tab.k === "vulnerabilities" && vulns.length > 0}
            <span class="ml-1 text-[10px] text-rose-400">({vulns.length})</span>
          {/if}
          {#if tab.k === "misconfigs" && misconfigs.length > 0}
            <span class="ml-1 text-[10px] text-amber-400">({misconfigs.length})</span>
          {/if}
          {#if tab.k === "secrets" && secrets.length > 0}
            <span class="ml-1 text-[10px] text-rose-400">({secrets.length})</span>
          {/if}
          {#if tab.k === "sbom" && sboms.length > 0}
            <span class="ml-1 text-[10px] text-slate-400">({sboms.length})</span>
          {/if}
        </button>
      {/each}
    </div>
  </Card.Header>

  <Card.Content class="space-y-4">
    {#if actionNotice?.type === "success"}
      <Alert.Root variant="default">
        <Alert.Title>Action completed</Alert.Title>
        <Alert.Description>{actionNotice.text}</Alert.Description>
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
    <CommandConsole session={localScanSession} label="Local Trivy scan" />

    {#if activeTab === "overview"}
      {#if !trivyInstalled}
        <div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-2">
          <div class="flex items-start gap-3">
            <ShieldCheck class="h-6 w-6 text-sky-400 shrink-0 mt-0.5" />
            <div class="space-y-2">
              <p class="text-sm font-semibold text-foreground">
                Scan this cluster for known CVEs, misconfigs and exposed secrets
              </p>
              <p class="text-xs text-muted-foreground">
                Trivy Operator runs in-cluster, continuously scanning all workloads and producing
                structured reports via CRDs.
              </p>
              <ol class="text-xs text-muted-foreground list-decimal pl-5 space-y-0.5">
                <li>Run pre-flight to confirm CRDs, namespace, RBAC, disk</li>
                <li>Install via Helm (operator + scanner)</li>
                <li>First scan takes 10-15 min while CVE DB downloads from ghcr.io</li>
                <li>Review Vulnerabilities / Misconfigurations / Exposed Secrets tabs</li>
                <li>Copy fix commands from the Vulnerabilities tab</li>
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

      {#if trivyInstalled && (vulns.length > 0 || misconfigs.length > 0 || secrets.length > 0)}
        <div class="rounded-lg border border-border p-3 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <p class="text-sm font-semibold">Security posture</p>
            {#if criticalDelta != null}
              <span
                class="text-xs {criticalDelta > 0
                  ? 'text-rose-400'
                  : criticalDelta < 0
                    ? 'text-emerald-400'
                    : 'text-muted-foreground'}"
              >
                Critical CVEs: {criticalDelta > 0 ? "+" : ""}{criticalDelta} vs previous scan
              </span>
            {/if}
          </div>
          <div class="grid gap-2 md:grid-cols-3">
            <div class="rounded border border-border p-2.5 text-xs">
              <p class="text-muted-foreground mb-1">Vulnerabilities</p>
              <p class="text-2xl font-mono font-bold">{vulns.length}</p>
              <div class="flex flex-wrap gap-1 mt-1 text-[10px]">
                {#each Object.entries(severityCountsFromVulns) as [sev, count] (sev)}
                  {#if count > 0}
                    <span class="{severityTextClass[sev]} capitalize">{sev}: {count}</span>
                  {/if}
                {/each}
              </div>
              <p class="text-[10px] text-emerald-400 mt-1">{fixableVulns} fixable</p>
            </div>
            <div class="rounded border border-border p-2.5 text-xs">
              <p class="text-muted-foreground mb-1">Misconfigurations</p>
              <p class="text-2xl font-mono font-bold">{misconfigs.length}</p>
              <div class="flex flex-wrap gap-1 mt-1 text-[10px]">
                {#each Object.entries(severityCountsFromMisconfigs) as [sev, count] (sev)}
                  {#if count > 0}
                    <span class="{severityTextClass[sev]} capitalize">{sev}: {count}</span>
                  {/if}
                {/each}
              </div>
            </div>
            <div class="rounded border border-border p-2.5 text-xs">
              <p class="text-muted-foreground mb-1">Exposed Secrets</p>
              <p class="text-2xl font-mono font-bold {secrets.length > 0 ? 'text-rose-400' : ''}">
                {secrets.length}
              </p>
              <p class="text-[10px] text-muted-foreground mt-1">hard-coded in image layers</p>
            </div>
          </div>

          {#if vulns.length > 0}
            <div class="space-y-1">
              <p class="text-[10px] text-muted-foreground">CVE severity breakdown</p>
              <div class="flex h-2 w-full rounded overflow-hidden">
                {#each ["critical", "high", "medium", "low", "unknown"] as sev}
                  {#if severityCountsFromVulns[sev] > 0}
                    <div
                      class={severityClass[sev]}
                      style="width: {(severityCountsFromVulns[sev] / vulns.length) * 100}%"
                      title="{sev}: {severityCountsFromVulns[sev]}"
                    ></div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-lg border border-border p-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Clock4 class="h-4 w-4" /> Last scan
          </div>
          <p class="text-sm font-medium text-foreground">{formatDate(lastScanAt)}</p>
          <p class="text-xs text-muted-foreground">Updates after Run Trivy scan.</p>
          {#if dbStatus?.version}
            <p class="text-[10px] text-muted-foreground mt-1">Trivy {dbStatus.version}</p>
          {/if}
        </div>
        <div class="rounded-lg border border-border p-3">
          <p class="text-xs text-muted-foreground mb-1">Summary</p>
          <p class="text-sm font-semibold text-foreground">{summary?.message ?? "-"}</p>
          <p class="text-xs text-muted-foreground">
            Providers detected: {providers.filter((p) => p.status === "installed")
              .length}/{providers.length}
          </p>
        </div>
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
                <Badge class="text-white {providerBadgeClass[provider.status]}"
                  >{provider.status}</Badge
                >
              </div>
              {#if provider.message}
                <p class="text-xs text-muted-foreground">{provider.message}</p>
              {/if}
              {#if provider.releaseName || provider.namespace}
                <p class="mt-1 text-xs text-muted-foreground">
                  Release: {provider.releaseName ?? "-"}{provider.chartVersion
                    ? ` (v${provider.chartVersion})`
                    : ""}
                  - Namespace: {provider.namespace ?? "-"}
                </p>
              {/if}
              <div class="mt-2 flex flex-wrap gap-3 text-xs">
                <a
                  class="text-primary underline-offset-4 hover:underline"
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener">Documentation</a
                >
                <a
                  class="text-primary underline-offset-4 hover:underline"
                  href={provider.githubUrl}
                  target="_blank"
                  rel="noreferrer noopener">GitHub</a
                >
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

      {#if history.length > 0}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold">Scan history (last {history.length})</p>
          <table class="w-full text-xs">
            <thead class="text-muted-foreground text-left">
              <tr>
                <th class="py-1 font-normal">When</th>
                <th class="py-1 font-normal">CVEs</th>
                <th class="py-1 font-normal">Critical</th>
                <th class="py-1 font-normal">High</th>
                <th class="py-1 font-normal">Fixable</th>
                <th class="py-1 font-normal">Misconfigs</th>
                <th class="py-1 font-normal">Secrets</th>
              </tr>
            </thead>
            <tbody>
              {#each history as h}
                <tr class="border-t border-border">
                  <td class="py-1">{formatDate(h.ranAt)}</td>
                  <td class="py-1 font-mono">{h.totalVulns}</td>
                  <td class="py-1 text-rose-400 font-mono">{h.critical}</td>
                  <td class="py-1 text-orange-400 font-mono">{h.high}</td>
                  <td class="py-1 text-emerald-400 font-mono">{h.fixable}</td>
                  <td class="py-1 text-amber-400 font-mono">{h.misconfigs}</td>
                  <td class="py-1 text-rose-400 font-mono">{h.exposedSecrets}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

    {#if activeTab === "vulnerabilities"}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={fetchVulns}
          loading={vulnsLoading}
          loadingLabel="Loading"
          disabled={!trivyInstalled}
        >
          <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={vulnSeverityFilter}
        >
          <option value="all">Any severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="unknown">Unknown</option>
        </select>
        <label class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" class="h-3.5 w-3.5" bind:checked={vulnFixableOnly} />
          Fixable only
        </label>
        <input
          class="h-8 w-[220px] rounded border border-input bg-background px-2 text-xs"
          placeholder="CVE ID, package, image..."
          bind:value={vulnSearch}
        />
        <span class="text-xs text-muted-foreground">{filteredVulns.length} of {vulns.length}</span>
      </div>

      {#if !trivyInstalled}
        <p class="text-xs text-muted-foreground">Install Trivy Operator to list vulnerabilities.</p>
      {:else if vulnsError}
        {@const he = humanizeTrivyError(vulnsError)}
        <Alert.Root variant="destructive">
          <Alert.Title>{he.title}</Alert.Title>
          <Alert.Description>
            {#if he.hint}<p class="mb-1">{he.hint}</p>{/if}
            <pre class="whitespace-pre-wrap text-xs">{vulnsError}</pre>
          </Alert.Description>
        </Alert.Root>
      {:else if filteredVulns.length === 0 && !vulnsLoading}
        <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
          {vulns.length === 0
            ? "No vulnerability reports yet. Trivy scans take 10-15 min after install; try Refresh."
            : "No vulnerabilities match the current filter."}
        </div>
      {:else}
        <div class="overflow-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-normal">Severity</th>
                <th class="px-2 py-1.5 font-normal">CVE</th>
                <th class="px-2 py-1.5 font-normal">Package</th>
                <th class="px-2 py-1.5 font-normal">Installed</th>
                <th class="px-2 py-1.5 font-normal">Fixed</th>
                <th class="px-2 py-1.5 font-normal">Resource</th>
                <th class="px-2 py-1.5 font-normal">Image</th>
                <th class="px-2 py-1.5 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredVulns.slice(0, vulnsRenderLimit) as v, i (v.vulnerabilityID + "/" + v.resource + "/" + v.pkgName + "#" + i)}
                {@const cveLink = nvdUrl(v.vulnerabilityID)}
                <tr class="border-t border-border hover:bg-muted/20">
                  <td class="px-2 py-1">
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] text-white {severityClass[
                        v.severity
                      ] ?? 'bg-slate-500'}">{v.severity}</span
                    >
                    <span
                      class="ml-1 rounded border px-1 text-[9px] uppercase {v.source === 'local'
                        ? 'border-sky-500/40 text-sky-300'
                        : 'border-slate-500/40 text-muted-foreground'}"
                      title={v.source === "local"
                        ? "Produced by local trivy binary"
                        : "Produced by Trivy Operator"}>{v.source}</span
                    >
                  </td>
                  <td class="px-2 py-1 font-mono">
                    {#if cveLink}
                      <a
                        class="text-primary hover:underline"
                        href={cveLink}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {v.vulnerabilityID}
                      </a>
                    {:else}
                      {v.vulnerabilityID}
                    {/if}
                    {#if v.score > 0}
                      <span class="ml-1 text-[10px] text-muted-foreground">CVSS {v.score}</span>
                    {/if}
                  </td>
                  <td class="px-2 py-1">{v.pkgName}</td>
                  <td class="px-2 py-1 font-mono text-[10px]">{v.installedVersion}</td>
                  <td class="px-2 py-1 font-mono text-[10px]">
                    {#if v.fixedVersion}
                      <span class="text-emerald-400">{v.fixedVersion}</span>
                    {:else}
                      <span class="text-muted-foreground">-</span>
                    {/if}
                  </td>
                  <td class="px-2 py-1 text-[10px]">
                    <button
                      type="button"
                      class="hover:underline text-left"
                      onclick={() => {
                        const wl = extractWorkloadFromReportName(v.resource);
                        jumpToResource(wl.kind, v.namespace);
                      }}
                      title="Jump to resource"
                    >
                      <span class="text-muted-foreground">{v.namespace}/</span>{v.resource}
                    </button>
                  </td>
                  <td class="px-2 py-1 font-mono text-[10px] text-muted-foreground">{v.image}</td>
                  <td class="px-2 py-1">
                    {#if v.fixedVersion}
                      <button
                        type="button"
                        class="inline-flex h-6 items-center rounded px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onclick={() => copySetImage(v.resource, v.image, v.fixedVersion)}
                        title="Copy kubectl set image command with fixed version"
                      >
                        Fix
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if filteredVulns.length > vulnsRenderLimit}
            <div
              class="flex items-center justify-between gap-2 p-2 text-[10px] text-muted-foreground"
            >
              <span
                >Showing {vulnsRenderLimit} of {filteredVulns.length}. Narrow filters for fewer
                rows.</span
              >
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
                onclick={() => (vulnsRenderLimit += PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, filteredVulns.length - vulnsRenderLimit)} more
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    {#if activeTab === "misconfigs"}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={fetchMisconfigs}
          loading={misconfigsLoading}
          loadingLabel="Loading"
          disabled={!trivyInstalled}
        >
          <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={misconfigSeverityFilter}
        >
          <option value="all">Any severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="unknown">Unknown</option>
        </select>
        <input
          class="h-8 w-[220px] rounded border border-input bg-background px-2 text-xs"
          placeholder="Check ID, category, resource..."
          bind:value={misconfigSearch}
        />
        <span class="text-xs text-muted-foreground"
          >{filteredMisconfigs.length} of {misconfigs.length}</span
        >
      </div>

      {#if !trivyInstalled}
        <p class="text-xs text-muted-foreground">
          Install Trivy Operator to list misconfigurations.
        </p>
      {:else if misconfigsError}
        {@const he = humanizeTrivyError(misconfigsError)}
        <Alert.Root variant="destructive">
          <Alert.Title>{he.title}</Alert.Title>
          <Alert.Description>
            {#if he.hint}<p class="mb-1">{he.hint}</p>{/if}
            <pre class="whitespace-pre-wrap text-xs">{misconfigsError}</pre>
          </Alert.Description>
        </Alert.Root>
      {:else if filteredMisconfigs.length === 0 && !misconfigsLoading}
        <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
          {misconfigs.length === 0
            ? "No misconfiguration reports yet. Try Refresh."
            : "No misconfigurations match the current filter."}
        </div>
      {:else}
        <div class="space-y-2">
          {#each filteredMisconfigs.slice(0, misconfigsRenderLimit) as m, i (m.checkID + "/" + m.resource + "#" + i)}
            {@const avd = avdUrl(m.checkID)}
            <div class="rounded border border-border p-2.5 text-xs space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] text-white {severityClass[m.severity] ??
                    'bg-slate-500'}">{m.severity}</span
                >
                <span
                  class="rounded border px-1 text-[9px] uppercase {m.source === 'local'
                    ? 'border-sky-500/40 text-sky-300'
                    : 'border-slate-500/40 text-muted-foreground'}"
                  title={m.source === "local"
                    ? "Produced by local trivy binary"
                    : "Produced by Trivy Operator"}>{m.source}</span
                >
                {#if avd}
                  <a
                    class="font-mono text-primary hover:underline"
                    href={avd}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {m.checkID}
                  </a>
                {:else}
                  <span class="font-mono">{m.checkID}</span>
                {/if}
                {#if m.category}<span class="text-[10px] text-muted-foreground">{m.category}</span
                  >{/if}
                <button
                  class="ml-auto text-[10px] hover:underline text-muted-foreground"
                  onclick={() => jumpToResource("pod", m.namespace)}
                >
                  {m.namespace}/{m.resource}
                </button>
              </div>
              <p class="font-medium text-foreground">{m.title}</p>
              {#if m.description}
                <p class="text-muted-foreground">{m.description}</p>
              {/if}
              {#if m.messages.length > 0}
                <ul class="text-[10px] text-slate-400 list-disc pl-4">
                  {#each m.messages as msg}<li>{msg}</li>{/each}
                </ul>
              {/if}
            </div>
          {/each}
          {#if filteredMisconfigs.length > misconfigsRenderLimit}
            <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span
                >Showing {misconfigsRenderLimit} of {filteredMisconfigs.length}. Narrow filters for
                fewer.</span
              >
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
                onclick={() => (misconfigsRenderLimit += PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, filteredMisconfigs.length - misconfigsRenderLimit)} more
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    {#if activeTab === "secrets"}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={fetchSecrets}
          loading={secretsLoading}
          loadingLabel="Loading"
          disabled={!trivyInstalled}
        >
          <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <input
          class="h-8 w-[220px] rounded border border-input bg-background px-2 text-xs"
          placeholder="Category, rule, resource..."
          bind:value={secretSearch}
        />
        <span class="text-xs text-muted-foreground"
          >{filteredSecrets.length} of {secrets.length}</span
        >
      </div>

      {#if !trivyInstalled}
        <p class="text-xs text-muted-foreground">Install Trivy Operator to list exposed secrets.</p>
      {:else if secretsError}
        {@const he = humanizeTrivyError(secretsError)}
        <Alert.Root variant="destructive">
          <Alert.Title>{he.title}</Alert.Title>
          <Alert.Description>
            {#if he.hint}<p class="mb-1">{he.hint}</p>{/if}
            <pre class="whitespace-pre-wrap text-xs">{secretsError}</pre>
          </Alert.Description>
        </Alert.Root>
      {:else if filteredSecrets.length === 0 && !secretsLoading}
        <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
          {secrets.length === 0
            ? "No exposed secrets found. Clean image - good job."
            : "No secrets match the current filter."}
        </div>
      {:else}
        <div class="space-y-2">
          {#each filteredSecrets.slice(0, secretsRenderLimit) as s, i (s.ruleID + "/" + s.resource + "/" + s.target + "#" + i)}
            <div class="rounded border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] text-white {severityClass[s.severity] ??
                    'bg-slate-500'}">{s.severity}</span
                >
                <span
                  class="rounded border px-1 text-[9px] uppercase {s.source === 'local'
                    ? 'border-sky-500/40 text-sky-300'
                    : 'border-slate-500/40 text-muted-foreground'}"
                  title={s.source === "local"
                    ? "Produced by local trivy binary"
                    : "Produced by Trivy Operator"}>{s.source}</span
                >
                <span class="font-mono">{s.ruleID}</span>
                {#if s.category}<span class="text-[10px] text-muted-foreground">{s.category}</span
                  >{/if}
                <button
                  type="button"
                  class="ml-auto text-[10px] hover:underline text-muted-foreground"
                  onclick={() => jumpToResource("pod", s.namespace)}
                >
                  {s.namespace}/{s.resource}
                </button>
              </div>
              <p class="font-medium text-foreground">{s.title}</p>
              {#if s.target}
                <p class="text-[10px] text-muted-foreground font-mono">location: {s.target}</p>
              {/if}
              {#if s.match}
                <p class="text-[10px] text-rose-400 font-mono">match: {s.match}</p>
              {/if}
            </div>
          {/each}
          {#if filteredSecrets.length > secretsRenderLimit}
            <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span
                >Showing {secretsRenderLimit} of {filteredSecrets.length}. Narrow filters for fewer.</span
              >
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
                onclick={() => (secretsRenderLimit += PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, filteredSecrets.length - secretsRenderLimit)} more
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    {#if activeTab === "sbom"}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={fetchSboms}
          loading={sbomsLoading}
          loadingLabel="Loading"
          disabled={!trivyInstalled}
        >
          <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <span class="text-xs text-muted-foreground">{sboms.length} SBOM reports</span>
      </div>

      {#if !trivyInstalled}
        <p class="text-xs text-muted-foreground">Install Trivy Operator to list SBOM reports.</p>
      {:else if sboms.length === 0 && !sbomsLoading}
        <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
          No SBOM reports yet. Trivy Operator creates these per workload image after scans complete.
        </div>
      {:else}
        <div class="overflow-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-normal">Resource</th>
                <th class="px-2 py-1.5 font-normal">Image</th>
                <th class="px-2 py-1.5 font-normal">Components</th>
                <th class="px-2 py-1.5 font-normal">Generated</th>
              </tr>
            </thead>
            <tbody>
              {#each sboms as s, i (s.namespace + "/" + s.resource + "#" + i)}
                <tr class="border-t border-border">
                  <td class="px-2 py-1">
                    <button
                      class="hover:underline"
                      onclick={() => jumpToResource("pod", s.namespace)}
                    >
                      {s.namespace}/{s.resource}
                    </button>
                  </td>
                  <td class="px-2 py-1 font-mono text-[10px]">{s.image}</td>
                  <td class="px-2 py-1 font-mono">{s.componentCount}</td>
                  <td class="px-2 py-1 text-muted-foreground">{formatDate(s.updatedAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

    {#if activeTab === "report"}
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onclick={downloadCombinedReport}
            disabled={vulns.length + misconfigs.length + secrets.length === 0}
          >
            <Download class="mr-1 h-3.5 w-3.5" /> Download combined report
          </Button>
          {#if reportRaw && hasJsonReport()}
            <Button size="sm" variant="outline" onclick={downloadReportJson}>
              <Download class="mr-1 h-3.5 w-3.5" /> Download scan JSON
            </Button>
            <Button size="sm" variant="ghost" onclick={() => copyText(reportRaw!, "report JSON")}>
              <Copy class="mr-1 h-3 w-3" /> Copy
            </Button>
            <select
              class="rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
              bind:value={reportView}
            >
              <option value="cards">Cards view</option>
              <option value="raw">Raw JSON</option>
            </select>
          {/if}
          <span class="text-xs text-muted-foreground">Generated: {formatDate(lastScanAt)}</span>
        </div>

        {#if !reportRaw}
          <p class="text-xs text-muted-foreground">
            No scan report yet. Run Trivy scan from the Overview tab.
          </p>
        {:else}
          <p class="text-xs text-muted-foreground">Latest Trivy scan report</p>
          {#if reportView === "raw"}
            <pre
              class="min-h-56 max-h-[70vh] resize-y overflow-auto whitespace-pre-wrap rounded border border-border bg-background/40 p-2 text-xs text-muted-foreground">{reportRaw}</pre>
          {:else if parsedReport}
            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-lg border border-border p-3">
                <p class="text-xs text-muted-foreground mb-1">Summary</p>
                <p class="text-xs">
                  <span class="text-foreground font-mono"
                    >{parsedReport.summary?.findings ?? 0}</span
                  >
                  <span class="text-muted-foreground"> findings</span>
                </p>
                <p class="text-xs">
                  <span class="text-foreground font-mono"
                    >{parsedReport.summary?.providersInstalled ?? 0}</span
                  >
                  <span class="text-muted-foreground"> providers installed</span>
                </p>
                <p class="text-xs">
                  <span
                    class="{(parsedReport.summary?.errors ?? 0) > 0
                      ? 'text-rose-400'
                      : 'text-muted-foreground'} font-mono"
                  >
                    {parsedReport.summary?.errors ?? 0}
                  </span>
                  <span class="text-muted-foreground"> errors</span>
                </p>
                {#if (parsedReport.summary?.checks?.total ?? 0) > 0}
                  <p class="text-xs mt-1">
                    Checks:
                    <span class="text-rose-400"
                      >FAIL {parsedReport.summary?.checks?.failed ?? 0}</span
                    >
                    -
                    <span class="text-emerald-400"
                      >PASS {parsedReport.summary?.checks?.passed ?? 0}</span
                    >
                    -
                    <span class="text-muted-foreground"
                      >total {parsedReport.summary?.checks?.total ?? 0}</span
                    >
                  </p>
                {/if}
              </div>
              <div class="rounded-lg border border-border p-3">
                <p class="text-xs text-muted-foreground mb-1">Providers</p>
                <ul class="text-xs space-y-0.5">
                  {#each parsedReport.providers ?? [] as prov}
                    <li>
                      <span class="font-mono">{prov.id}</span>:
                      <span
                        class={prov.status === "installed"
                          ? "text-emerald-400"
                          : "text-muted-foreground"}>{prov.status}</span
                      >
                      {#if prov.namespace}<span class="text-muted-foreground">
                          / {prov.namespace}</span
                        >{/if}
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
            {#if parsedReport.resources && parsedReport.resources.length > 0}
              <div class="rounded-lg border border-border p-3 space-y-2">
                <p class="text-sm font-semibold">Resources scanned</p>
                <table class="w-full text-xs">
                  <thead class="text-muted-foreground text-left">
                    <tr>
                      <th class="py-1 font-normal">Resource</th>
                      <th class="py-1 font-normal">Available</th>
                      <th class="py-1 font-normal">Count</th>
                      <th class="py-1 font-normal">Top namespaces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each parsedReport.resources as r (r.resource)}
                      <tr class="border-t border-border">
                        <td class="py-1 font-mono">{r.resource}</td>
                        <td class="py-1">
                          {#if r.available}<span class="text-emerald-400">yes</span>{:else}<span
                              class="text-slate-500">no</span
                            >{/if}
                        </td>
                        <td class="py-1">{r.count ?? 0}</td>
                        <td class="py-1 text-muted-foreground truncate">
                          {(r.details?.namespaces ?? []).slice(0, 3).join(", ") || "-"}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
            {#if (parsedReport.errors ?? []).length > 0}
              <div class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
                <p class="text-xs font-semibold text-rose-300">Errors during scan</p>
                <ul class="text-xs text-rose-300/80 list-disc pl-4">
                  {#each parsedReport.errors ?? [] as err}<li>{err}</li>{/each}
                </ul>
              </div>
            {/if}
          {/if}
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
