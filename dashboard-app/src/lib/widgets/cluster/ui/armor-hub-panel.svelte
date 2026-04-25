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
  import {
    runPreflight,
    type PreflightReport,
    type PreflightCheck,
  } from "$features/armor-hub/model/preflight";
  import { humanizeArmorError } from "$features/armor-hub/model/humanize";
  import { STARTER_POLICIES } from "$features/armor-hub/model/starter-policies";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FileText from "@lucide/svelte/icons/file-text";
  import Copy from "@lucide/svelte/icons/copy";
  import * as Popover from "$shared/ui/popover";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { uninstallHelmRelease } from "$shared/api/helm";
  import { appDataDir } from "@tauri-apps/api/path";
  import { writeTextFile, remove, BaseDirectory } from "@tauri-apps/plugin-fs";
  import { CONFIG_DIR } from "$entities/config/model/appConfig";
  import { clusterKey } from "$shared/lib/cluster-key";
  import { toast } from "svelte-sonner";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type TabKey = "overview" | "policies" | "alerts" | "report";

  interface PolicyItem {
    name: string;
    namespace: string;
    kind: string;
    action: string;
    severity: number;
    message?: string;
    selector?: string;
    rules: string[];
  }

  interface DsRollout {
    name: string;
    desired: number;
    current: number;
    ready: number;
  }

  let activeTab = $state<TabKey>("overview");
  let refreshing = $state(false);
  let providerAction = $state<
    Record<string, { status: "idle" | "working" | "error"; message?: string }>
  >({});
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  let scanning = $state(false);
  let armorReportView = $state<"cards" | "raw">("cards");
  let refreshRequestId = 0;
  let installRequestId = 0;
  let scanRequestId = 0;

  let preflight = $state<PreflightReport | null>(null);
  let preflightRunning = $state(false);

  let policies = $state<PolicyItem[]>([]);
  let policiesLoading = $state(false);
  let policiesError = $state<string | null>(null);
  let policySearch = $state("");

  let rollout = $state<DsRollout | null>(null);
  let rolloutLoading = $state(false);

  let uninstalling = $state(false);
  let fetchingLogs = $state(false);

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
  const kubearmorProvider = $derived(providers.find((p) => p.id === "kubearmor"));
  const runScanDisabledReason = $derived.by(() => {
    if (scanning) return "Armor scan is already running";
    if (!kubearmorInstalled) return "Install KubeArmor first to enable scan";
    return "Run armor scan now";
  });
  const humanizedNotice = $derived.by(() => {
    if (!actionNotice || actionNotice.type !== "error") return null;
    return humanizeArmorError(actionNotice.text);
  });
  const installSession = createConsoleSession();
  let installLabel = $state("KubeArmor");

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

  function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  }
  function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
  }

  const parsedReport = $derived.by(() => {
    if (!reportRaw) return null;
    return parseJson(reportRaw) as {
      generatedAt?: string;
      summary?: {
        providersInstalled?: number;
        policies?: number;
        alerts?: number;
        errors?: number;
        severity?: Record<string, number>;
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
        };
      }>;
      errors?: string[];
    } | null;
  });

  const totalSeverity = $derived.by(() => {
    const sev = parsedReport?.summary?.severity ?? {};
    const entries = Object.entries(sev).filter(([, v]) => (v ?? 0) > 0);
    const total = entries.reduce((sum, [, v]) => sum + (v ?? 0), 0);
    return { entries, total };
  });

  const severityColors: Record<string, string> = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500",
    info: "bg-slate-500",
  };

  function downloadReportJson() {
    if (!reportRaw) return;
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

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  async function handleInstall(providerId: ArmorProviderId, title: string) {
    if (providerAction[providerId]?.status === "working") return;
    const requestId = ++installRequestId;
    const activeClusterId = clusterId;
    providerAction = { ...providerAction, [providerId]: { status: "working" } };
    actionNotice = null;
    installLabel = `Installing ${title}`;
    installSession.start();
    try {
      const result = await installArmorProvider(activeClusterId, providerId, (chunk) =>
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
        text: `${title} installed via Helm. Checking DaemonSet rollout.`,
      };
      installSession.succeed();
      await runArmorHubScan(activeClusterId, { force: true });
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      void fetchRollout();
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
      const result = await runArmorScanNow(activeClusterId);
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        actionNotice = { type: "error", text: result.error?.trim() || "Failed to run armor scan" };
        return;
      }
      armorReportView = "cards";
      actionNotice = { type: "success", text: "Armor scan completed." };
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

  async function fetchRollout() {
    if (!kubearmorProvider?.namespace) return;
    rolloutLoading = true;
    try {
      const res = await kubectlRawArgsFront(
        [
          "get",
          "daemonset",
          "-n",
          kubearmorProvider.namespace,
          "-l",
          "kubearmor-app=kubearmor",
          "-o",
          "json",
        ],
        { clusterId },
      );
      if (res.errors || res.code !== 0) {
        rollout = null;
        return;
      }
      const parsed = parseJson(res.output) as { items?: unknown[] } | null;
      const items = asArray(parsed?.items);
      if (items.length === 0) {
        // Fallback without label
        const res2 = await kubectlRawArgsFront(
          ["get", "daemonset", "-n", kubearmorProvider.namespace, "-o", "json"],
          { clusterId },
        );
        if (res2.code === 0 && !res2.errors) {
          const p2 = parseJson(res2.output) as { items?: unknown[] } | null;
          const all = asArray(p2?.items);
          const ds = all.find((x) =>
            String(asRecord(asRecord(x).metadata).name ?? "")
              .toLowerCase()
              .includes("kubearmor"),
          );
          if (ds) {
            const m = asRecord(asRecord(ds).metadata);
            const st = asRecord(asRecord(ds).status);
            rollout = {
              name: String(m.name ?? ""),
              desired: Number(st.desiredNumberScheduled ?? 0),
              current: Number(st.currentNumberScheduled ?? 0),
              ready: Number(st.numberReady ?? 0),
            };
            return;
          }
        }
        rollout = null;
        return;
      }
      const ds = items[0];
      const m = asRecord(asRecord(ds).metadata);
      const st = asRecord(asRecord(ds).status);
      rollout = {
        name: String(m.name ?? ""),
        desired: Number(st.desiredNumberScheduled ?? 0),
        current: Number(st.currentNumberScheduled ?? 0),
        ready: Number(st.numberReady ?? 0),
      };
    } catch {
      rollout = null;
    } finally {
      rolloutLoading = false;
    }
  }

  function summarizeSelector(spec: Record<string, unknown>): string {
    const sel = asRecord(spec.selector);
    const matchLabels = asRecord(sel.matchLabels);
    const labelPairs = Object.entries(matchLabels).map(([k, v]) => `${k}=${String(v)}`);
    const matchExpr = asArray(sel.matchExpressions);
    const exprPairs = matchExpr.map((e) => {
      const r = asRecord(e);
      return `${String(r.key ?? "")} ${String(r.operator ?? "")} [${(asArray(r.values) as unknown[]).join(",")}]`;
    });
    const all = [...labelPairs, ...exprPairs].filter(Boolean);
    return all.length > 0 ? all.join(" , ") : "all pods";
  }

  function extractRules(spec: Record<string, unknown>): string[] {
    const rules: string[] = [];
    const p = asRecord(spec.process);
    const f = asRecord(spec.file);
    const n = asRecord(spec.network);
    const c = asRecord(spec.capabilities);
    const paths = (obj: Record<string, unknown>, key: string) =>
      asArray(obj[key]).map((x) => String(asRecord(x).path ?? asRecord(x).dir ?? ""));
    const procPaths = paths(p, "matchPaths");
    const procDirs = paths(p, "matchDirectories");
    if (procPaths.length || procDirs.length)
      rules.push(`process: ${[...procPaths, ...procDirs].filter(Boolean).slice(0, 3).join(", ")}`);
    const filePaths = paths(f, "matchPaths");
    const fileDirs = paths(f, "matchDirectories");
    if (filePaths.length || fileDirs.length)
      rules.push(`file: ${[...filePaths, ...fileDirs].filter(Boolean).slice(0, 3).join(", ")}`);
    const protos = asArray(n.matchProtocols).map((x) => String(asRecord(x).protocol ?? ""));
    if (protos.length) rules.push(`network: ${protos.join(", ")}`);
    const caps = asArray(c.matchCapabilities).map((x) => String(asRecord(x).capability ?? ""));
    if (caps.length) rules.push(`cap: ${caps.join(", ")}`);
    return rules;
  }

  async function fetchPolicies() {
    if (policiesLoading) return;
    policiesLoading = true;
    policiesError = null;
    try {
      const [ns, cluster, host] = await Promise.all([
        kubectlRawArgsFront(["get", "kubearmorpolicies", "-A", "-o", "json"], { clusterId }),
        kubectlRawArgsFront(["get", "kubearmorclusterpolicies", "-o", "json"], { clusterId }),
        kubectlRawArgsFront(["get", "kubearmorhostpolicies", "-o", "json"], { clusterId }),
      ]);
      const collected: PolicyItem[] = [];
      const ingest = (res: typeof ns, kind: string) => {
        if (res.errors || res.code !== 0) return;
        const parsed = parseJson(res.output) as { items?: unknown[] } | null;
        for (const item of asArray(parsed?.items)) {
          const m = asRecord(asRecord(item).metadata);
          const spec = asRecord(asRecord(item).spec);
          collected.push({
            kind,
            name: String(m.name ?? ""),
            namespace: String(m.namespace ?? ""),
            action: String(spec.action ?? "Audit"),
            severity: Number(spec.severity ?? 0),
            message: typeof spec.message === "string" ? spec.message : undefined,
            selector: summarizeSelector(spec),
            rules: extractRules(spec),
          });
        }
      };
      ingest(ns, "KubeArmorPolicy");
      ingest(cluster, "KubeArmorClusterPolicy");
      ingest(host, "KubeArmorHostPolicy");
      policies = collected.sort((a, b) => b.severity - a.severity);
      // Surface any combined error if all three failed
      if (
        (ns.errors || ns.code !== 0) &&
        (cluster.errors || cluster.code !== 0) &&
        (host.errors || host.code !== 0)
      ) {
        policiesError = (
          ns.errors ||
          ns.output ||
          cluster.errors ||
          "Failed to fetch policies"
        ).toString();
      }
    } catch (e) {
      policiesError = (e as Error).message;
    } finally {
      policiesLoading = false;
    }
  }

  async function applyStarter(yaml: string, title: string, id: string) {
    const safeCluster = clusterKey(clusterId) || "cluster";
    const relPath = `${CONFIG_DIR}/kubearmor-starter-${safeCluster}-${id}.yaml`;
    try {
      const dir = await appDataDir();
      const absPath = `${dir}/${relPath}`;
      await writeTextFile(relPath, `${yaml}\n`, { baseDir: BaseDirectory.AppData });
      const res = await kubectlRawArgsFront(["apply", "-f", absPath], { clusterId });
      if (res.errors || res.code !== 0) {
        const err = res.errors || res.output || "Apply failed";
        const he = humanizeArmorError(err);
        toast.error(`${he.title}: ${err}`);
        return;
      }
      toast.success(`Applied: ${title}`);
      void fetchPolicies();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      await remove(relPath, { baseDir: BaseDirectory.AppData }).catch(() => {});
    }
  }

  async function deletePolicy(item: PolicyItem) {
    if (!confirm(`Delete ${item.kind}/${item.name}? This removes enforcement immediately.`)) return;
    const args = item.namespace
      ? ["delete", item.kind.toLowerCase(), item.name, "-n", item.namespace]
      : ["delete", item.kind.toLowerCase(), item.name];
    const res = await kubectlRawArgsFront(args, { clusterId });
    if (res.errors || res.code !== 0) {
      toast.error(`Delete failed: ${res.errors || res.output}`);
      return;
    }
    toast.success(`Deleted ${item.name}`);
    void fetchPolicies();
  }

  async function doUninstall() {
    if (!kubearmorProvider?.releaseName || !kubearmorProvider.namespace) return;
    if (
      !confirm(
        `Uninstall KubeArmor release '${kubearmorProvider.releaseName}' from namespace '${kubearmorProvider.namespace}'? All enforcement stops immediately.`,
      )
    )
      return;
    uninstalling = true;
    try {
      const result = await uninstallHelmRelease(clusterId, {
        releaseName: kubearmorProvider.releaseName,
        namespace: kubearmorProvider.namespace,
      });
      if (!result.success) {
        actionNotice = { type: "error", text: result.error ?? "Uninstall failed" };
        return;
      }
      actionNotice = { type: "success", text: "KubeArmor uninstalled. Refresh status to confirm." };
      await runArmorHubScan(clusterId, { force: true });
    } catch (e) {
      actionNotice = { type: "error", text: (e as Error).message };
    } finally {
      uninstalling = false;
    }
  }

  async function copyLogsCommand() {
    const ns = kubearmorProvider?.namespace ?? "kubearmor";
    const cmd = `kubectl logs -n ${ns} daemonset/kubearmor --tail=200 -f`;
    copyText(cmd, "kubectl logs command");
  }

  async function fetchRecentLogs() {
    if (fetchingLogs || !kubearmorProvider?.namespace) return;
    fetchingLogs = true;
    try {
      const res = await kubectlRawArgsFront(
        ["logs", "-n", kubearmorProvider.namespace, "daemonset/kubearmor", "--tail=100"],
        { clusterId },
      );
      if (res.errors || res.code !== 0) {
        toast.error(`Logs failed: ${res.errors || res.output}`);
        return;
      }
      copyText(res.output || "(empty)", "recent armor logs (100 lines)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      fetchingLogs = false;
    }
  }

  const filteredPolicies = $derived.by(() => {
    const q = policySearch.trim().toLowerCase();
    if (!q) return policies;
    return policies.filter((p) =>
      [p.name, p.namespace, p.action, p.message ?? "", p.selector ?? "", p.rules.join(" ")].some(
        (v) => v.toLowerCase().includes(q),
      ),
    );
  });

  function severityTextClass(s: number): string {
    if (s >= 8) return "text-rose-400";
    if (s >= 6) return "text-orange-400";
    if (s >= 4) return "text-amber-400";
    return "text-slate-400";
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

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    installRequestId += 1;
    scanRequestId += 1;
    preflight = null;
    rollout = null;
    policies = [];
  });

  $effect(() => {
    if (!clusterId) return;
    if (offline) {
      markArmorHubUnavailable(clusterId, "Armor integration unavailable: cluster is offline");
      return;
    }
    void runArmorHubScan(clusterId, { force: false, statusOnly: true });
  });

  $effect(() => {
    if (kubearmorInstalled && !rollout && !rolloutLoading) {
      void fetchRollout();
    }
  });

  $effect(() => {
    if (
      activeTab === "policies" &&
      policies.length === 0 &&
      !policiesLoading &&
      kubearmorInstalled
    ) {
      void fetchPolicies();
    }
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-lg font-semibold" title="Runtime protection via KubeArmor">KubeArmor</h2>
        {#if summary}
          <Badge class="text-white {summaryBadgeClass[summary.status]}">{summary.status}</Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="About KubeArmor"
              title="About KubeArmor"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[460px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">What KubeArmor defends against</p>
            <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
              <li>
                Unauthorized process execution in containers (reverse shells, package managers)
              </li>
              <li>File tampering in sensitive paths (/etc/passwd, /etc/shadow, /root)</li>
              <li>Service-account token theft from /var/run/secrets</li>
              <li>Raw network / ICMP spoofing from pods</li>
              <li>Privileged capability abuse (CAP_SYS_ADMIN, mount syscalls)</li>
            </ul>
            <p class="text-xs text-muted-foreground">
              Enforcement happens in the kernel via BPF-LSM (kernel 5.8+) or AppArmor. Policies run
              in Audit (log-only) or Block (deny + log) mode.
            </p>
            <div class="text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://docs.kubearmor.io/"
                target="_blank"
                rel="noreferrer noopener">Documentation</a
              >
              -
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubearmor/KubeArmor"
                target="_blank"
                rel="noreferrer noopener">GitHub</a
              >
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
        {#if kubearmorInstalled}
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

    <!-- Tab navigation -->
    <div class="flex items-center gap-1 border-b border-border">
      {#each [{ k: "overview", label: "Overview" }, { k: "policies", label: "Policies" }, { k: "alerts", label: "Alerts" }, { k: "report", label: "Report" }] as tab (tab.k)}
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = tab.k as TabKey)}
        >
          {tab.label}
          {#if tab.k === "policies" && policies.length > 0}
            <span class="ml-1 text-[10px] text-muted-foreground">({policies.length})</span>
          {/if}
          {#if tab.k === "alerts" && parsedReport?.summary?.alerts}
            <span class="ml-1 text-[10px] text-muted-foreground"
              >({parsedReport.summary.alerts})</span
            >
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

    {#if activeTab === "overview"}
      <!-- Onboarding when not installed -->
      {#if !kubearmorInstalled}
        <div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-3">
          <div class="flex items-start gap-3">
            <ShieldCheck class="h-6 w-6 text-sky-400 shrink-0 mt-0.5" />
            <div class="space-y-2">
              <p class="text-sm font-semibold text-foreground">
                Turn on runtime protection for this cluster
              </p>
              <p class="text-xs text-muted-foreground">
                KubeArmor is a kernel-level enforcer for Kubernetes workloads. It installs as a
                DaemonSet on every node and can <span class="text-emerald-400">audit</span>
                (log-only) or <span class="text-rose-400">block</span>
                process, file, network and capability actions inside pods.
              </p>
              <ol class="text-xs text-muted-foreground list-decimal pl-5 space-y-1">
                <li>Run pre-flight to confirm kernel / OS / runtime support</li>
                <li>Install via Helm (chart: kubearmor/kubearmor-operator)</li>
                <li>Wait for DaemonSet rollout on all nodes</li>
                <li>Go to Policies tab and apply a starter policy in Audit mode</li>
                <li>Review Alerts, then flip the policy to Block when confident</li>
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

      <!-- Preflight results -->
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

      <!-- Status cards -->
      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-lg border border-border p-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Clock4 class="h-4 w-4" /> Last scan
          </div>
          <p class="text-sm font-medium text-foreground">{formatDate(lastScanAt)}</p>
          <p class="text-xs text-muted-foreground">Updates after Run armor scan.</p>
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

      <!-- DaemonSet rollout (only after install) -->
      {#if kubearmorInstalled}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold">DaemonSet rollout</p>
            <Button
              variant="ghost"
              size="sm"
              onclick={fetchRollout}
              loading={rolloutLoading}
              loadingLabel="Checking"
            >
              <Refresh class="mr-2 h-3.5 w-3.5" /> Check
            </Button>
          </div>
          {#if rollout}
            {@const pct =
              rollout.desired > 0 ? Math.floor((rollout.ready / rollout.desired) * 100) : 0}
            <div class="space-y-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted-foreground">{rollout.name}</span>
                <span
                  class="font-mono {rollout.ready === rollout.desired
                    ? 'text-emerald-400'
                    : 'text-amber-400'}"
                >
                  {rollout.ready}/{rollout.desired} ready
                </span>
              </div>
              <div class="h-1.5 rounded bg-slate-700 overflow-hidden">
                <div
                  class="h-full {rollout.ready === rollout.desired
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'}"
                  style="width: {pct}%"
                ></div>
              </div>
              <p class="text-[10px] text-muted-foreground">
                {rollout.ready === rollout.desired
                  ? "All nodes protected"
                  : "Enforcement is partial until all pods are Ready"}
              </p>
            </div>
          {:else}
            <p class="text-xs text-muted-foreground">
              DaemonSet not detected yet. Click Check to poll.
            </p>
          {/if}
        </div>
      {/if}

      <!-- Providers -->
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

      {#if summary?.status === "unavailable"}
        <Alert.Root variant="default">
          <Alert.Title>Integrations not detected</Alert.Title>
          <Alert.Description>{summary?.message ?? "KubeArmor is not detected."}</Alert.Description>
        </Alert.Root>
      {/if}
    {/if}

    {#if activeTab === "policies"}
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onclick={fetchPolicies}
            loading={policiesLoading}
            loadingLabel="Loading"
            disabled={!kubearmorInstalled}
          >
            <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh policies
          </Button>
          <input
            class="h-8 max-w-[260px] rounded border border-input bg-background px-2 text-xs"
            placeholder="Filter policies..."
            bind:value={policySearch}
          />
          <span class="text-xs text-muted-foreground">
            {filteredPolicies.length} of {policies.length} shown
          </span>
        </div>

        {#if !kubearmorInstalled}
          <p class="text-xs text-muted-foreground">
            Install KubeArmor to list and manage policies.
          </p>
        {:else if policiesError}
          {@const he = humanizeArmorError(policiesError)}
          <Alert.Root variant="destructive">
            <Alert.Title>{he.title}</Alert.Title>
            <Alert.Description>
              {#if he.hint}
                <p class="mb-1">{he.hint}</p>
              {/if}
              <pre class="whitespace-pre-wrap text-xs">{policiesError}</pre>
            </Alert.Description>
          </Alert.Root>
        {:else if filteredPolicies.length === 0 && !policiesLoading}
          <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
            {policies.length === 0
              ? "No KubeArmor policies installed. Apply a starter policy below to begin."
              : "No policies match the current filter."}
          </div>
        {:else}
          <div class="space-y-2">
            {#each filteredPolicies as p (p.kind + "/" + p.namespace + "/" + p.name)}
              <div class="rounded border border-border p-2.5 text-xs">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-[10px] text-slate-500">{p.kind}</span>
                  <span class="font-semibold text-foreground">{p.name}</span>
                  {#if p.namespace}
                    <span class="text-slate-500">- ns: {p.namespace}</span>
                  {/if}
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] {p.action === 'Block'
                      ? 'bg-rose-500/20 text-rose-300'
                      : p.action === 'Audit'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'}">{p.action}</span
                  >
                  {#if p.severity > 0}
                    <span class="{severityTextClass(p.severity)} font-mono text-[10px]"
                      >sev {p.severity}</span
                    >
                  {/if}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="ml-auto h-6 text-[10px]"
                    onclick={() => deletePolicy(p)}
                  >
                    Delete
                  </Button>
                </div>
                {#if p.selector}
                  <p class="mt-1 text-[10px] text-muted-foreground">target: {p.selector}</p>
                {/if}
                {#if p.rules.length > 0}
                  <ul class="mt-0.5 text-[10px] text-slate-400 list-disc pl-4">
                    {#each p.rules as r}
                      <li>{r}</li>
                    {/each}
                  </ul>
                {/if}
                {#if p.message}
                  <p class="mt-1 text-[10px] italic text-slate-500">"{p.message}"</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Starter policy catalog -->
        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold">Starter catalog</p>
          <p class="text-xs text-muted-foreground">
            One-click apply for common runtime hardening rules. Start with Audit, review Alerts,
            switch to Block when confident.
          </p>
          <div class="grid gap-2 md:grid-cols-2">
            {#each STARTER_POLICIES as sp (sp.id)}
              <div class="rounded border border-border p-2.5 text-xs space-y-1">
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-foreground">{sp.title}</span>
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] {sp.action === 'Block'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-amber-500/20 text-amber-300'}">{sp.action}</span
                  >
                  <span class="{severityTextClass(sp.severity)} font-mono text-[10px]"
                    >sev {sp.severity}</span
                  >
                </div>
                <p class="text-[11px] text-muted-foreground">{sp.description}</p>
                <div class="flex flex-wrap gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 text-[10px]"
                    disabled={!kubearmorInstalled}
                    onclick={() => applyStarter(sp.yaml, sp.title, sp.id)}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-7 text-[10px]"
                    onclick={() => copyText(sp.yaml, sp.title + " YAML")}
                  >
                    <Copy class="mr-1 h-3 w-3" /> Copy YAML
                  </Button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if activeTab === "alerts"}
      <div class="space-y-3">
        {#if !parsedReport}
          <p class="text-xs text-muted-foreground">
            No scan report yet. Run armor scan on the Overview tab to populate alerts and severity.
          </p>
        {:else if totalSeverity.total === 0}
          <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
            No alerts with severity recorded in the last scan. Apply Block policies from the
            Policies tab to start generating events.
          </div>
        {:else}
          <div class="rounded-lg border border-border p-3 space-y-2">
            <p class="text-sm font-semibold">Severity breakdown</p>
            <div class="flex h-3 w-full rounded overflow-hidden">
              {#each totalSeverity.entries as [sev, count] (sev)}
                {@const pct = (count! / totalSeverity.total) * 100}
                <div
                  class={severityColors[sev] ?? "bg-slate-500"}
                  style="width: {pct}%"
                  title="{sev}: {count}"
                ></div>
              {/each}
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {#each totalSeverity.entries as [sev, count] (sev)}
                <div class="flex items-center gap-1.5">
                  <span class="h-2 w-2 rounded {severityColors[sev] ?? 'bg-slate-500'}"></span>
                  <span class="capitalize text-muted-foreground">{sev}</span>
                  <span class="font-mono text-foreground">{count}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if parsedReport?.resources}
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
                      {#if r.available}
                        <span class="text-emerald-400">yes</span>
                      {:else}
                        <span class="text-slate-500">no</span>
                      {/if}
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

        <div class="rounded-lg border border-border p-3 space-y-1">
          <p class="text-sm font-semibold">Live alerts stream</p>
          <p class="text-xs text-muted-foreground">
            KubeArmor emits alerts as structured log lines on its DaemonSet. Use either of the
            actions above the tabs to fetch recent logs (one-shot) or copy a live-follow command for
            your terminal.
          </p>
        </div>
      </div>
    {/if}

    {#if activeTab === "report"}
      <div class="space-y-3">
        {#if !reportRaw}
          <p class="text-xs text-muted-foreground">
            No report yet. Click Run armor scan on the Overview tab.
          </p>
        {:else}
          <div class="flex flex-wrap items-center gap-2">
            <select
              class="rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
              bind:value={armorReportView}
            >
              <option value="cards">Cards view</option>
              <option value="raw">Raw JSON</option>
            </select>
            <Button size="sm" variant="outline" onclick={downloadReportJson}>Download JSON</Button>
            <Button size="sm" variant="ghost" onclick={() => copyText(reportRaw, "report JSON")}>
              <Copy class="mr-1 h-3 w-3" /> Copy
            </Button>
            <span class="text-xs text-muted-foreground">
              Generated: {formatDate(lastScanAt)}
            </span>
          </div>

          <p class="text-xs text-muted-foreground">Latest armor scan report</p>

          {#if armorReportView === "raw"}
            <pre
              class="min-h-56 max-h-[70vh] resize-y overflow-auto whitespace-pre-wrap rounded border border-border bg-background/40 p-2 text-xs text-muted-foreground">{reportRaw}</pre>
          {:else if parsedReport}
            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-lg border border-border p-3">
                <p class="text-xs text-muted-foreground mb-1">Summary</p>
                <p class="text-xs">
                  <span class="text-foreground font-mono"
                    >{parsedReport.summary?.providersInstalled ?? 0}</span
                  >
                  <span class="text-muted-foreground"> providers installed</span>
                </p>
                <p class="text-xs">
                  <span class="text-foreground font-mono"
                    >{parsedReport.summary?.policies ?? 0}</span
                  >
                  <span class="text-muted-foreground"> policies</span>
                </p>
                <p class="text-xs">
                  <span class="text-foreground font-mono">{parsedReport.summary?.alerts ?? 0}</span>
                  <span class="text-muted-foreground"> alerts</span>
                </p>
                <p class="text-xs">
                  <span
                    class="{parsedReport.summary?.errors
                      ? 'text-rose-400'
                      : 'text-muted-foreground'} font-mono"
                  >
                    {parsedReport.summary?.errors ?? 0}
                  </span>
                  <span class="text-muted-foreground"> errors</span>
                </p>
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
                      {#if prov.releaseName}<span class="text-muted-foreground">
                          / {prov.releaseName}</span
                        >{/if}
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
            {#if (parsedReport.errors ?? []).length > 0}
              <div class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
                <p class="text-xs font-semibold text-rose-300">Errors during scan</p>
                <ul class="text-xs text-rose-300/80 list-disc pl-4">
                  {#each parsedReport.errors ?? [] as err}
                    <li>{err}</li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
