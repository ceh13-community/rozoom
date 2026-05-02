<script lang="ts">
  import { onMount } from "svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    alertHubConfig,
    alertHubState,
    createSilence,
    markAlertHubUnavailable,
    runAlertHubScan,
    startAlertHubPolling,
    stopAlertHubPolling,
  } from "$features/alerts-hub";
  import type { AlertItem, AlertSeverity, AlertSource, AlertState } from "$features/alerts-hub";
  import { humanizeAlertError } from "$features/alerts-hub/model/humanize";
  import {
    runPreflight,
    type PreflightReport,
    type PreflightCheck,
  } from "$features/alerts-hub/model/preflight";
  import { lookupRunbook } from "$features/alerts-hub/model/runbooks";
  import {
    getPrometheusStackRelease,
    installPrometheusStack,
    type HelmListedRelease,
  } from "$shared/api/helm";
  import { kubectlRawArgsFront, kubectlRawFront } from "$shared/api/kubectl-proxy";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { Input } from "$shared/ui/input";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import * as Table from "$shared/ui/table";
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
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

  type TabKey = "overview" | "alerts" | "silences" | "rules" | "events";

  interface PromRule {
    name: string;
    group: string;
    namespace: string;
    expr: string;
    forPeriod: string;
    severity: string;
    summary: string;
    description: string;
    labels: Record<string, string>;
  }

  interface WarningEvent {
    name: string;
    namespace: string;
    reason: string;
    kind: string;
    objectName: string;
    message: string;
    count: number;
    lastTimestamp: string;
  }

  interface LocalSilence {
    alertname: string;
    namespace?: string;
    matchers: { name: string; value: string }[];
    duration: number;
    author: string;
    comment: string;
    createdAt: string;
    endsAt: string;
  }

  const hubState = $derived($alertHubState[clusterId]);
  const summary = $derived(hubState?.summary ?? null);
  const config = $derived($alertHubConfig);

  let activeTab = $state<TabKey>("overview");

  let stateFilter = $state<AlertState | "all">("all");
  let severityFilter = $state<AlertSeverity | "all">("all");
  let sourceFilter = $state<AlertSource | "all">("all");
  let timeFilter = $state<"1h" | "6h" | "24h" | "all">("6h");
  let groupBy = $state<"none" | "alertname" | "namespace" | "receiver">("alertname");
  let searchValue = $state("");
  let debouncedSearch = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  let monitoringLoading = $state(false);
  let monitoringInstalling = $state(false);
  let refreshing = $state(false);
  let refreshError = $state<string | null>(null);
  let monitoringRelease = $state<HelmListedRelease | null>(null);
  let monitoringError = $state<string | null>(null);
  let monitoringMessage = $state<string | null>(null);
  let monitoringNamespaceDraft = $state("monitoring");
  let monitoringCollapsed = $state(false);
  let pageVisible = $state(true);
  let refreshRequestId = 0;
  let monitoringRequestId = 0;
  let monitoringInstallRequestId = 0;

  let preflight = $state<PreflightReport | null>(null);
  let preflightRunning = $state(false);

  let rules = $state<PromRule[]>([]);
  let rulesLoading = $state(false);
  let rulesError = $state<string | null>(null);
  let rulesSearch = $state("");

  let events = $state<WarningEvent[]>([]);
  let eventsLoading = $state(false);
  let eventsError = $state<string | null>(null);
  let eventsSearch = $state("");

  let expandedAlertId = $state<string | null>(null);

  // Silence form state
  let silenceFormOpen = $state(false);
  let silenceDraft = $state<{
    alertname: string;
    namespace: string;
    durationHours: number;
    author: string;
    comment: string;
    extraMatchers: { name: string; value: string }[];
  }>({
    alertname: "",
    namespace: "",
    durationHours: 4,
    author: loadPrefAuthor(),
    comment: "",
    extraMatchers: [],
  });

  const installSession = createConsoleSession();
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const stateIcons: Record<AlertState, string> = {
    firing: "F",
    pending: "P",
    silenced: "S",
    inhibited: "I",
  };

  const stateClass: Record<AlertState, string> = {
    firing: "bg-rose-600 text-white",
    pending: "bg-amber-500 text-white",
    silenced: "bg-slate-500 text-white",
    inhibited: "bg-slate-400 text-white",
  };

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    unavailable: "bg-slate-500",
  };

  const severityStyles: Record<AlertSeverity, string> = {
    page: "bg-rose-600",
    warn: "bg-amber-500",
    info: "bg-slate-500",
    unknown: "bg-slate-400",
  };

  const severityRank: Record<AlertSeverity, number> = { page: 3, warn: 2, info: 1, unknown: 0 };

  function loadPrefAuthor(): string {
    if (typeof localStorage === "undefined") return "operator@rozoom";
    return localStorage.getItem("dashboard:alerts:author") ?? "operator@rozoom";
  }

  function persistPrefAuthor(value: string) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("dashboard:alerts:author", value);
  }

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

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function matchesTimeFilter(alert: AlertItem) {
    if (timeFilter === "all") return true;
    const hours = Number.parseInt(timeFilter.replace("h", ""), 10);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return new Date(alert.since).getTime() >= cutoff;
  }

  function matchesSearch(alert: AlertItem) {
    if (!debouncedSearch.trim()) return true;
    const text =
      `${alert.alertname} ${alert.summary ?? ""} ${alert.description ?? ""} ${Object.values(alert.labels).join(" ")}`.toLowerCase();
    return text.includes(debouncedSearch.trim().toLowerCase());
  }

  const allAlerts = $derived(hubState?.alerts ?? []);

  const filteredAlerts = $derived.by(() => {
    return allAlerts.filter((alert) => {
      const stateOk = stateFilter === "all" || alert.state === stateFilter;
      const severityOk = severityFilter === "all" || alert.severity === severityFilter;
      const sourceOk = sourceFilter === "all" || alert.source === sourceFilter;
      return stateOk && severityOk && sourceOk && matchesTimeFilter(alert) && matchesSearch(alert);
    });
  });

  interface AlertGroup {
    key: string;
    items: AlertItem[];
    maxSeverity: AlertSeverity;
    firing: number;
    silenced: number;
    pending: number;
    oldest: string;
  }

  const groupedAlerts = $derived.by<AlertGroup[]>(() => {
    const items = filteredAlerts;
    const makeGroup = (key: string, list: AlertItem[]): AlertGroup => ({
      key,
      items: list,
      maxSeverity: list.reduce<AlertSeverity>(
        (max, a) => (severityRank[a.severity] > severityRank[max] ? a.severity : max),
        "unknown",
      ),
      firing: list.filter((a) => a.state === "firing").length,
      silenced: list.filter((a) => a.state === "silenced").length,
      pending: list.filter((a) => a.state === "pending").length,
      oldest: list.reduce(
        (o, a) => (new Date(a.since) < new Date(o) ? a.since : o),
        list[0]?.since ?? "",
      ),
    });

    if (groupBy === "none") {
      return [makeGroup("All alerts", items)];
    }
    const groups = new Map<string, AlertItem[]>();
    for (const alert of items) {
      const key =
        groupBy === "alertname"
          ? alert.alertname
          : groupBy === "namespace"
            ? (alert.namespace ?? "(none)")
            : (alert.receiver ?? "(none)");
      const list = groups.get(key) ?? [];
      list.push(alert);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([key, list]) => makeGroup(key, list));
  });

  const severityCounts = $derived.by(() => {
    const out: Record<AlertSeverity, number> = { page: 0, warn: 0, info: 0, unknown: 0 };
    for (const a of allAlerts) out[a.severity]++;
    return out;
  });

  const stateCounts = $derived.by(() => {
    const out: Record<AlertState, number> = { firing: 0, pending: 0, silenced: 0, inhibited: 0 };
    for (const a of allAlerts) out[a.state]++;
    return out;
  });

  const silencedAlerts = $derived(allAlerts.filter((a) => a.state === "silenced"));

  const humanizedRefresh = $derived(refreshError ? humanizeAlertError(refreshError) : null);
  const humanizedMonitoring = $derived(
    monitoringError ? humanizeAlertError(monitoringError) : null,
  );

  async function runNow() {
    if (!clusterId || refreshing) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    refreshing = true;
    refreshError = null;
    try {
      await runAlertHubScan(activeClusterId, { force: true });
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
    } catch (error) {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshError = error instanceof Error ? error.message : "Failed to refresh alert status";
    } finally {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshing = false;
    }
  }

  function chartVersion(chart: string | undefined): string {
    if (!chart) return "unknown";
    const match = chart.match(/-(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/);
    return match?.[1] ?? "unknown";
  }

  function podIsReady(pod: {
    status?: {
      phase?: string;
      conditions?: Array<{ type?: string; status?: string }>;
      containerStatuses?: Array<{ ready?: boolean }>;
    };
  }) {
    const phase = (pod.status?.phase || "").toLowerCase();
    if (phase !== "running") return false;
    const readyCondition =
      pod.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false;
    const allReady =
      (pod.status?.containerStatuses?.length ?? 0) > 0 &&
      (pod.status?.containerStatuses?.every((c) => c.ready === true) ?? false);
    return readyCondition || allReady;
  }

  async function checkPrometheusStackReadiness(
    checkClusterId: string,
    namespace: string,
  ): Promise<{ ready: boolean; error?: string }> {
    const podsRaw = await kubectlRawFront(`get pod -n ${namespace} -o json`, {
      clusterId: checkClusterId,
    });
    if (podsRaw.errors.length || podsRaw.code !== 0) {
      return { ready: false, error: podsRaw.errors || "Failed to query monitoring pods" };
    }
    try {
      const parsed = JSON.parse(podsRaw.output) as {
        items?: Array<{
          metadata?: { name?: string; labels?: Record<string, string> };
          status?: {
            phase?: string;
            conditions?: Array<{ type?: string; status?: string }>;
            containerStatuses?: Array<{ ready?: boolean }>;
          };
        }>;
      };
      const items = parsed.items ?? [];
      const isAm = (p: (typeof items)[number]) =>
        (p.metadata?.name ?? "").toLowerCase().includes("alertmanager") ||
        (p.metadata?.labels?.["app.kubernetes.io/name"] ?? "")
          .toLowerCase()
          .includes("alertmanager");
      const isProm = (p: (typeof items)[number]) => {
        const name = (p.metadata?.name ?? "").toLowerCase();
        const appName = (p.metadata?.labels?.["app.kubernetes.io/name"] ?? "").toLowerCase();
        if (isAm(p)) return false;
        if (name.includes("operator") || appName.includes("operator")) return false;
        if (name.includes("node-exporter") || appName.includes("node-exporter")) return false;
        if (name.includes("kube-state-metrics") || appName.includes("kube-state-metrics"))
          return false;
        return name.includes("prometheus") || appName.includes("prometheus");
      };
      const alertReady = items.filter(isAm).some(podIsReady);
      const promReady = items.filter(isProm).some(podIsReady);
      if (!alertReady || !promReady) {
        return {
          ready: false,
          error: `Monitoring stack installed but not ready (prometheus ready: ${promReady ? "yes" : "no"}, alertmanager ready: ${alertReady ? "yes" : "no"})`,
        };
      }
      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : "Failed to parse monitoring pod state",
      };
    }
  }

  async function refreshMonitoringStatus() {
    if (!clusterId) return;
    const requestId = ++monitoringRequestId;
    const activeClusterId = clusterId;
    monitoringLoading = true;
    monitoringError = null;
    try {
      const release = await getPrometheusStackRelease(activeClusterId);
      if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
      if (release.error) {
        monitoringRelease = null;
        monitoringError = release.error;
        return;
      }
      monitoringRelease = release.release ?? null;
      if (monitoringRelease?.namespace) {
        monitoringNamespaceDraft = monitoringRelease.namespace;
        const readiness = await checkPrometheusStackReadiness(
          activeClusterId,
          monitoringRelease.namespace,
        );
        if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
        if (!readiness.ready) {
          monitoringError = readiness.error ?? "Monitoring stack is not Ready";
        } else {
          monitoringCollapsed = true;
        }
      }
    } catch (error) {
      if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
      monitoringRelease = null;
      monitoringError =
        error instanceof Error ? error.message : "Failed to check monitoring Helm release";
    } finally {
      if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
      monitoringLoading = false;
    }
  }

  async function installMonitoringStack() {
    if (!clusterId || monitoringInstalling || monitoringLoading) return;
    const requestId = ++monitoringInstallRequestId;
    const activeClusterId = clusterId;
    monitoringInstalling = true;
    monitoringError = null;
    monitoringMessage = null;
    installSession.start();
    try {
      const namespace = monitoringNamespaceDraft.trim() || "monitoring";
      const result = await installPrometheusStack(activeClusterId, namespace, (chunk) =>
        installSession.append(chunk),
      );
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        throw new Error(result.error ?? "Failed to install Prometheus stack");
      }
      await refreshMonitoringStatus();
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      await runAlertHubScan(activeClusterId, { force: true });
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      monitoringMessage = `Monitoring stack is installed in namespace ${namespace}.`;
      installSession.succeed();
    } catch (error) {
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      monitoringError =
        error instanceof Error ? error.message : "Failed to install monitoring stack";
      installSession.fail();
    } finally {
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      monitoringInstalling = false;
    }
  }

  async function doPreflight() {
    if (preflightRunning) return;
    preflightRunning = true;
    try {
      preflight = await runPreflight(clusterId);
    } catch (e) {
      refreshError = (e as Error).message;
    } finally {
      preflightRunning = false;
    }
  }

  async function fetchRules() {
    if (rulesLoading) return;
    rulesLoading = true;
    rulesError = null;
    try {
      const res = await kubectlRawArgsFront(["get", "prometheusrules", "-A", "-o", "json"], {
        clusterId,
      });
      if (res.errors || res.code !== 0) {
        rulesError = res.errors || res.output || "Failed to fetch PrometheusRule resources";
        return;
      }
      const parsed = parseJson(res.output) as { items?: unknown[] } | null;
      const collected: PromRule[] = [];
      for (const item of asArray(parsed?.items)) {
        const m = asRecord(asRecord(item).metadata);
        const spec = asRecord(asRecord(item).spec);
        for (const group of asArray(spec.groups)) {
          const g = asRecord(group);
          const groupName = typeof g.name === "string" ? g.name : "";
          for (const rule of asArray(g.rules)) {
            const rr = asRecord(rule);
            const name = typeof rr.alert === "string" ? rr.alert : "";
            if (!name) continue; // skip recording rules
            const labels = asRecord(rr.labels) as Record<string, string>;
            const annotations = asRecord(rr.annotations) as Record<string, string>;
            collected.push({
              name,
              group: groupName,
              namespace: typeof m.namespace === "string" ? m.namespace : "",
              expr: typeof rr.expr === "string" ? rr.expr : "",
              forPeriod: typeof rr.for === "string" ? rr.for : "",
              severity: typeof labels.severity === "string" ? labels.severity : "",
              summary: typeof annotations.summary === "string" ? annotations.summary : "",
              description:
                typeof annotations.description === "string" ? annotations.description : "",
              labels,
            });
          }
        }
      }
      rules = collected.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      rulesError = (e as Error).message;
    } finally {
      rulesLoading = false;
    }
  }

  async function fetchEvents() {
    if (eventsLoading) return;
    eventsLoading = true;
    eventsError = null;
    try {
      const res = await kubectlRawArgsFront(
        ["get", "events", "-A", "--field-selector=type=Warning", "-o", "json"],
        { clusterId },
      );
      if (res.errors || res.code !== 0) {
        eventsError = res.errors || res.output || "Failed to fetch events";
        return;
      }
      const parsed = parseJson(res.output) as { items?: unknown[] } | null;
      const collected: WarningEvent[] = [];
      for (const item of asArray(parsed?.items)) {
        const m = asRecord(asRecord(item).metadata);
        const involved = asRecord(asRecord(item).involvedObject);
        const ev = asRecord(item);
        collected.push({
          name: typeof m.name === "string" ? m.name : "",
          namespace: typeof m.namespace === "string" ? m.namespace : "",
          reason: typeof ev.reason === "string" ? ev.reason : "",
          kind: typeof involved.kind === "string" ? involved.kind : "",
          objectName: typeof involved.name === "string" ? involved.name : "",
          message: typeof ev.message === "string" ? ev.message : "",
          count: typeof ev.count === "number" ? ev.count : 1,
          lastTimestamp:
            (typeof ev.lastTimestamp === "string" && ev.lastTimestamp) ||
            (typeof ev.eventTime === "string" && ev.eventTime) ||
            "",
        });
      }
      events = collected.sort((a, b) => {
        const ta = Date.parse(a.lastTimestamp) || 0;
        const tb = Date.parse(b.lastTimestamp) || 0;
        return tb - ta;
      });
    } catch (e) {
      eventsError = (e as Error).message;
    } finally {
      eventsLoading = false;
    }
  }

  const filteredRules = $derived.by(() => {
    if (!rulesSearch.trim()) return rules;
    const q = rulesSearch.trim().toLowerCase();
    return rules.filter((r) =>
      [r.name, r.group, r.namespace, r.expr, r.summary, r.severity].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  });

  const filteredEvents = $derived.by(() => {
    if (!eventsSearch.trim()) return events;
    const q = eventsSearch.trim().toLowerCase();
    return events.filter((e) =>
      [e.reason, e.kind, e.objectName, e.message, e.namespace].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  });

  function openSilenceForm(alert: AlertItem) {
    silenceDraft = {
      alertname: alert.alertname,
      namespace: alert.namespace ?? "",
      durationHours: 4,
      author: silenceDraft.author || loadPrefAuthor(),
      comment: "",
      extraMatchers: [],
    };
    silenceFormOpen = true;
  }

  function addMatcher() {
    silenceDraft = {
      ...silenceDraft,
      extraMatchers: [...silenceDraft.extraMatchers, { name: "", value: "" }],
    };
  }

  function removeMatcher(idx: number) {
    silenceDraft = {
      ...silenceDraft,
      extraMatchers: silenceDraft.extraMatchers.filter((_, i) => i !== idx),
    };
  }

  function submitSilence() {
    if (!silenceDraft.alertname.trim()) {
      toast.error("alertname is required");
      return;
    }
    if (!silenceDraft.comment.trim()) {
      toast.error("comment is required by Alertmanager");
      return;
    }
    persistPrefAuthor(silenceDraft.author);
    createSilence(clusterId, {
      alertname: silenceDraft.alertname,
      namespace: silenceDraft.namespace || undefined,
      durationHours: silenceDraft.durationHours,
      author: silenceDraft.author,
      comment: silenceDraft.comment,
    });
    toast.success("Silence applied locally. Use Copy curl for Alertmanager API.");
    silenceFormOpen = false;
  }

  function silenceCurlCommand(): string {
    const matchers = [
      { name: "alertname", value: silenceDraft.alertname, isRegex: false },
      ...(silenceDraft.namespace
        ? [{ name: "namespace", value: silenceDraft.namespace, isRegex: false }]
        : []),
      ...silenceDraft.extraMatchers
        .filter((m) => m.name && m.value)
        .map((m) => ({ name: m.name, value: m.value, isRegex: false })),
    ];
    const endsAt = new Date(Date.now() + silenceDraft.durationHours * 60 * 60 * 1000).toISOString();
    const payload = {
      matchers,
      startsAt: new Date().toISOString(),
      endsAt,
      createdBy: silenceDraft.author,
      comment: silenceDraft.comment,
    };
    return [
      "# Port-forward Alertmanager first:",
      "# kubectl port-forward -n monitoring svc/alertmanager 9093:9093",
      "",
      `curl -X POST http://localhost:9093/api/v2/silences \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '${JSON.stringify(payload)}'`,
    ].join("\n");
  }

  function jumpToResource(kind: string, name: string | undefined, namespace: string | undefined) {
    if (!kind) return;
    const params = new URLSearchParams($page.url.search);
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
      node: "nodesstatus",
      namespace: "namespaces",
    };
    const workload = workloadMap[kind.toLowerCase()] ?? "pods";
    params.set("workload", workload);
    if (namespace) params.set("namespace", namespace);
    void goto(`?${params.toString()}`, { keepFocus: false });
    void name;
  }

  function openInPrometheus(expr: string) {
    if (!monitoringRelease?.namespace) {
      toast.error("Prometheus stack not installed");
      return;
    }
    // We can only suggest a URL; user must port-forward first.
    const url = `http://localhost:9090/graph?g0.expr=${encodeURIComponent(expr)}&g0.tab=0`;
    copyText(
      `# Port-forward Prometheus first:\n# kubectl port-forward -n ${monitoringRelease.namespace} svc/prometheus-operated 9090:9090\n\n# Then open: ${url}`,
      "Prometheus graph URL",
    );
  }

  function copyAlertAsMarkdown(alert: AlertItem) {
    const labelLines = Object.entries(alert.labels)
      .map(([k, v]) => `- \`${k}\`: ${v}`)
      .join("\n");
    const annotLines = Object.entries(alert.annotations)
      .map(([k, v]) => `- \`${k}\`: ${v}`)
      .join("\n");
    const runbook = alert.runbookUrl || lookupRunbook(alert.alertname) || "(none)";
    const md = [
      `## ${alert.alertname} (${alert.severity})`,
      "",
      `- State: **${alert.state}**`,
      `- Since: ${formatDate(alert.since)}`,
      alert.namespace ? `- Namespace: \`${alert.namespace}\`` : "",
      alert.pod ? `- Pod: \`${alert.pod}\`` : "",
      alert.node ? `- Node: \`${alert.node}\`` : "",
      alert.receiver ? `- Receiver: \`${alert.receiver}\`` : "",
      `- Runbook: ${runbook}`,
      "",
      "### Summary",
      alert.summary ?? "(none)",
      "",
      "### Description",
      alert.description ?? "(none)",
      "",
      "### Labels",
      labelLines || "(none)",
      "",
      "### Annotations",
      annotLines || "(none)",
    ]
      .filter(Boolean)
      .join("\n");
    copyText(md, "alert as markdown");
  }

  function exportFiringAsCsv() {
    const firing = allAlerts.filter((a) => a.state === "firing");
    if (firing.length === 0) {
      toast.info("No firing alerts to export");
      return;
    }
    const rows = [
      ["alertname", "severity", "state", "since", "namespace", "pod", "node", "summary"],
      ...firing.map((a) => [
        a.alertname,
        a.severity,
        a.state,
        a.since,
        a.namespace ?? "",
        a.pod ?? "",
        a.node ?? "",
        (a.summary ?? "").replace(/"/g, '""'),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alerts-firing-${clusterId}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  function syncPageVisibility() {
    if (typeof document === "undefined") {
      pageVisible = true;
      return;
    }
    pageVisible = document.visibilityState !== "hidden";
  }

  onMount(() => {
    syncPageVisibility();
    const handleVisibility = () => syncPageVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    monitoringRequestId += 1;
    monitoringInstallRequestId += 1;
    preflight = null;
    rules = [];
    events = [];
  });

  $effect(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedSearch = searchValue;
    }, 500);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  $effect(() => {
    if (!clusterId) return;
    if (offline) {
      stopAlertHubPolling(clusterId);
      markAlertHubUnavailable(clusterId, "Alert feed unavailable: cluster is offline");
      return;
    }
    if (!autoDiagnosticsEnabled) {
      stopAlertHubPolling(clusterId);
      return;
    }
    if (!pageVisible) {
      stopAlertHubPolling(clusterId);
      return;
    }
    startAlertHubPolling(clusterId);
    void refreshMonitoringStatus();
    return () => {
      stopAlertHubPolling(clusterId);
    };
  });

  $effect(() => {
    if (activeTab === "rules" && rules.length === 0 && !rulesLoading) void fetchRules();
    if (activeTab === "events" && events.length === 0 && !eventsLoading) void fetchEvents();
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Unified feed of metric-based alerts + K8s warning events"
        >
          Cluster Alerts
        </h2>
        {#if summary}
          <Badge class="text-white {statusStyles[summary.status]}">{summary.status}</Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Cluster alerts info"
              title="About alerts"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[480px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Three sources, one feed</p>
            <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
              <li>
                <span class="text-foreground">Alertmanager</span> - groups, routes, silences firing alerts
                from Prometheus (primary source)
              </li>
              <li>
                <span class="text-foreground">Prometheus /api/v1/alerts</span> - raw alerts not yet processed
                by Alertmanager (fallback)
              </li>
              <li>
                <span class="text-foreground">Kubernetes events (Warning)</span> - OOMKilled, FailedScheduling,
                FailedMount, etc. (always-on)
              </li>
            </ul>
            <p class="text-xs text-muted-foreground">
              Typical alerts: KubePodCrashLooping, NodeDiskPressure, KubeAPIDown,
              AlertmanagerFailedReload, CertManagerCertExpirySoon.
            </p>
            <div class="text-xs flex gap-3">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/prometheus/prometheus"
                target="_blank"
                rel="noreferrer noopener">Prometheus</a
              >
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/prometheus/alertmanager"
                target="_blank"
                rel="noreferrer noopener">Alertmanager</a
              >
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://runbooks.prometheus-operator.dev/"
                target="_blank"
                rel="noreferrer noopener">Runbooks</a
              >
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" onclick={runNow} loading={refreshing} loadingLabel="Refreshing">
          <Refresh class="mr-2 h-4 w-4" /> Refresh status
        </Button>
      </div>
    </div>

    <div class="flex items-center gap-1 border-b border-border mt-1">
      {#each [{ k: "overview", label: "Overview" }, { k: "alerts", label: "Alerts" }, { k: "silences", label: "Silences" }, { k: "rules", label: "Rules" }, { k: "events", label: "Events" }] as tab (tab.k)}
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = tab.k as TabKey)}
        >
          {tab.label}
          {#if tab.k === "alerts" && stateCounts.firing > 0}
            <span class="ml-1 text-[10px] text-rose-400">({stateCounts.firing})</span>
          {/if}
          {#if tab.k === "silences" && silencedAlerts.length > 0}
            <span class="ml-1 text-[10px] text-slate-400">({silencedAlerts.length})</span>
          {/if}
          {#if tab.k === "rules" && rules.length > 0}
            <span class="ml-1 text-[10px] text-muted-foreground">({rules.length})</span>
          {/if}
          {#if tab.k === "events" && events.length > 0}
            <span class="ml-1 text-[10px] text-amber-400">({events.length})</span>
          {/if}
        </button>
      {/each}
    </div>
  </Card.Header>

  <Card.Content class="space-y-4">
    <!-- Monitoring stack block: collapsed when healthy -->
    <div class="rounded-lg border border-border/60 bg-background/40">
      <button
        type="button"
        class="w-full flex items-center justify-between gap-2 px-4 py-2 text-left hover:bg-muted/30"
        onclick={() => (monitoringCollapsed = !monitoringCollapsed)}
      >
        <div class="flex items-center gap-2">
          {#if monitoringCollapsed}
            <ChevronRight class="h-4 w-4 text-muted-foreground" />
          {:else}
            <ChevronDown class="h-4 w-4 text-muted-foreground" />
          {/if}
          <p class="text-xs font-semibold text-foreground">Prometheus + Alertmanager stack</p>
          {#if monitoringRelease && !monitoringError}
            <Badge class="bg-emerald-500 text-white">healthy</Badge>
          {:else if monitoringRelease}
            <Badge class="bg-amber-500 text-white">degraded</Badge>
          {:else}
            <Badge class="bg-slate-500 text-white">not installed</Badge>
          {/if}
        </div>
      </button>
      {#if !monitoringCollapsed}
        <div class="border-t border-border/60 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs text-muted-foreground">
                Helm release detection (cross-namespace check)
              </p>
              {#if monitoringLoading}
                <p class="text-sm text-muted-foreground inline-flex items-center gap-1">
                  <span>Checking</span><LoadingDots />
                </p>
              {:else if monitoringRelease}
                <p class="text-sm text-foreground">
                  Installed: <span class="font-semibold">{monitoringRelease.name}</span>
                  <span class="text-xs text-muted-foreground">
                    v{chartVersion(monitoringRelease.chart)}</span
                  >
                  in <span class="font-semibold">{monitoringRelease.namespace}</span> namespace
                </p>
              {:else}
                <p class="text-sm text-amber-600">Not installed</p>
              {/if}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {#if !monitoringRelease}
                <input
                  class="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm"
                  bind:value={monitoringNamespaceDraft}
                  placeholder="monitoring"
                  disabled={monitoringInstalling}
                />
              {/if}
              <Button
                variant="outline"
                onclick={refreshMonitoringStatus}
                loading={monitoringLoading}
                loadingLabel="Refreshing"
                disabled={monitoringInstalling}
              >
                Refresh status
              </Button>
              {#if !monitoringRelease}
                <Button
                  onclick={installMonitoringStack}
                  loading={monitoringInstalling}
                  loadingLabel="Installing"
                  disabled={monitoringLoading}
                >
                  <span>Install Prometheus + Alertmanager</span>
                </Button>
              {/if}
            </div>
          </div>
          {#if humanizedMonitoring}
            <Alert.Root variant="destructive" class="mt-3">
              <Alert.Title>{humanizedMonitoring.title}</Alert.Title>
              <Alert.Description>
                {#if humanizedMonitoring.hint}<p class="mb-1">{humanizedMonitoring.hint}</p>{/if}
                <details>
                  <summary class="cursor-pointer text-xs opacity-70">Raw error</summary>
                  <pre class="mt-1 whitespace-pre-wrap text-xs">{monitoringError}</pre>
                </details>
              </Alert.Description>
            </Alert.Root>
          {/if}
          {#if monitoringMessage}
            <p class="mt-2 text-xs text-emerald-600">{monitoringMessage}</p>
          {/if}
        </div>
      {/if}
      <div class="mt-2">
        <CommandConsole session={installSession} label="Prometheus stack" />
      </div>
    </div>

    {#if humanizedRefresh}
      <Alert.Root variant="destructive">
        <Alert.Title>{humanizedRefresh.title}</Alert.Title>
        <Alert.Description>
          {#if humanizedRefresh.hint}<p class="mb-1">{humanizedRefresh.hint}</p>{/if}
          <details>
            <summary class="cursor-pointer text-xs opacity-70">Raw error</summary>
            <pre class="mt-1 whitespace-pre-wrap text-xs">{refreshError}</pre>
          </details>
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if summary?.status === "unavailable" && !humanizedRefresh}
      <Alert.Root variant="destructive">
        <Alert.Title>Alert feed unavailable</Alert.Title>
        <Alert.Description>{summary.message}</Alert.Description>
      </Alert.Root>
    {:else if summary?.status === "degraded" && !humanizedRefresh}
      <Alert.Root variant="default">
        <Alert.Title>Degraded alert feed</Alert.Title>
        <Alert.Description>Fallback to Kubernetes events only.</Alert.Description>
      </Alert.Root>
    {/if}

    {#if activeTab === "overview"}
      {#if !monitoringRelease}
        <div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-2">
          <div class="flex items-start gap-3">
            <ShieldCheck class="h-6 w-6 text-sky-400 shrink-0 mt-0.5" />
            <div class="space-y-2">
              <p class="text-sm font-semibold text-foreground">Make this cluster alert-aware</p>
              <p class="text-xs text-muted-foreground">
                Kubernetes has no built-in alerting system. Install kube-prometheus-stack
                (Prometheus + Alertmanager + default rules) to start receiving signals about node
                failures, pod crash loops, certificate expiries, API server errors, and disk
                pressure.
              </p>
              <ul class="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                <li>
                  <span class="text-foreground">Prometheus</span> scrapes metrics and evaluates alerting
                  rules
                </li>
                <li>
                  <span class="text-foreground">Alertmanager</span> groups, routes (Slack/PagerDuty/email),
                  dedupes, silences
                </li>
                <li>
                  <span class="text-foreground">Kubernetes events</span> are always available as a fallback
                  source
                </li>
              </ul>
              <ol class="text-xs text-muted-foreground list-decimal pl-5 space-y-0.5">
                <li>Run pre-flight to confirm reachability + RBAC + CRDs</li>
                <li>Install kube-prometheus-stack (Helm chart)</li>
                <li>Wait for Prometheus + Alertmanager pods to be Ready</li>
                <li>Alerts appear in the Alerts tab; manage silences in Silences tab</li>
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

      <!-- Severity dashboard -->
      {#if allAlerts.length > 0}
        <div class="rounded-lg border border-border p-3 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <p class="text-sm font-semibold">Alert posture</p>
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{allAlerts.length} total</span>
              {#if stateCounts.firing > 0}
                <span class="text-rose-400 font-mono">{stateCounts.firing} firing</span>
              {/if}
            </div>
          </div>

          <div class="grid gap-2 md:grid-cols-4 text-xs">
            <div class="rounded bg-rose-500/10 border border-rose-500/30 p-2">
              <p class="text-rose-400 font-mono text-xl">{stateCounts.firing}</p>
              <p class="text-muted-foreground">Firing</p>
            </div>
            <div class="rounded bg-amber-500/10 border border-amber-500/30 p-2">
              <p class="text-amber-400 font-mono text-xl">{stateCounts.pending}</p>
              <p class="text-muted-foreground">Pending</p>
            </div>
            <div class="rounded bg-slate-500/10 border border-slate-500/30 p-2">
              <p class="text-slate-300 font-mono text-xl">{stateCounts.silenced}</p>
              <p class="text-muted-foreground">Silenced</p>
            </div>
            <div class="rounded bg-slate-500/10 border border-slate-500/30 p-2">
              <p class="text-slate-300 font-mono text-xl">{stateCounts.inhibited}</p>
              <p class="text-muted-foreground">Inhibited</p>
            </div>
          </div>

          <p class="text-[10px] text-muted-foreground">Severity breakdown</p>
          <div class="flex h-2 w-full rounded overflow-hidden">
            {#each ["page", "warn", "info", "unknown"] as sev}
              {#if severityCounts[sev as AlertSeverity] > 0}
                <div
                  class={severityStyles[sev as AlertSeverity]}
                  style="width: {(severityCounts[sev as AlertSeverity] / allAlerts.length) * 100}%"
                  title="{sev}: {severityCounts[sev as AlertSeverity]}"
                ></div>
              {/if}
            {/each}
          </div>
          <div class="flex flex-wrap gap-2 text-[10px]">
            {#each ["page", "warn", "info", "unknown"] as sev}
              {#if severityCounts[sev as AlertSeverity] > 0}
                <span class="flex items-center gap-1">
                  <span class="h-2 w-2 rounded {severityStyles[sev as AlertSeverity]}"></span>
                  <span class="capitalize text-muted-foreground">{sev}</span>
                  <span class="font-mono text-foreground"
                    >{severityCounts[sev as AlertSeverity]}</span
                  >
                </span>
              {/if}
            {/each}
          </div>

          <div class="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onclick={exportFiringAsCsv}>
              Export firing as CSV
            </Button>
          </div>
        </div>
      {/if}

      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-lg border border-border p-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Clock4 class="h-4 w-4" /> Last refresh
          </div>
          <p class="text-sm font-medium text-foreground">
            {formatDate(summary?.lastRunAt ?? null)}
          </p>
          <p class="text-xs text-muted-foreground">
            Source: {summary?.source ?? "none"} - Polling every {Math.round(
              config.scheduleMs / 1000,
            )}s
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            Alertmanager last success: {formatDate(summary?.alertmanagerLastSuccessAt ?? null)}
          </p>
          {#if summary?.alertmanagerLastError}
            {@const he = humanizeAlertError(summary.alertmanagerLastError)}
            <p class="mt-1 text-xs text-amber-600">{he.title}</p>
          {/if}
        </div>
        <div class="rounded-lg border border-border p-3">
          <p class="text-xs text-muted-foreground mb-1">Loaded alerts</p>
          <p class="text-2xl font-semibold text-foreground">{allAlerts.length}</p>
          <p class="text-xs text-muted-foreground">{summary?.message ?? "-"}</p>
        </div>
      </div>
    {/if}

    {#if activeTab === "alerts"}
      <div class="grid gap-3 lg:grid-cols-5">
        <div class="lg:col-span-2">
          <Input placeholder="Search alerts" bind:value={searchValue} />
        </div>
        <select
          class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          bind:value={stateFilter}
        >
          <option value="all">All states</option>
          <option value="firing">Firing</option>
          <option value="pending">Pending</option>
          <option value="silenced">Silenced</option>
          <option value="inhibited">Inhibited</option>
        </select>
        <select
          class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          bind:value={severityFilter}
        >
          <option value="all">All severities</option>
          <option value="page">Page</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          bind:value={sourceFilter}
        >
          <option value="all">All sources</option>
          <option value="alertmanager">Alertmanager</option>
          <option value="prometheus">Prometheus</option>
          <option value="events">Events</option>
        </select>
        <select
          class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          bind:value={timeFilter}
        >
          <option value="1h">Last 1h</option>
          <option value="6h">Last 6h</option>
          <option value="24h">Last 24h</option>
          <option value="all">All time</option>
        </select>
        <select
          class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          bind:value={groupBy}
        >
          <option value="none">No grouping</option>
          <option value="alertname">Group by alertname</option>
          <option value="namespace">Group by namespace</option>
          <option value="receiver">Group by receiver</option>
        </select>
      </div>

      <div class="space-y-4">
        {#if groupedAlerts.length === 0 || groupedAlerts[0].items.length === 0}
          <div class="rounded-lg border border-border/60 bg-background/40 p-2">
            <TableEmptyState message="No results for the current filter." />
          </div>
        {:else}
          {#each groupedAlerts as group (group.key)}
            <div class="rounded-lg border border-border/60 bg-background/40">
              <div
                class="flex items-center justify-between gap-2 border-b border-border px-4 py-2 flex-wrap"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="text-sm font-semibold text-foreground">{group.key}</p>
                  <Badge class="text-white {severityStyles[group.maxSeverity]}"
                    >{group.maxSeverity}</Badge
                  >
                  <Badge class="bg-secondary text-secondary-foreground">{group.items.length}</Badge>
                </div>
                <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {#if group.firing > 0}<span class="text-rose-400">{group.firing} firing</span
                    >{/if}
                  {#if group.pending > 0}<span class="text-amber-400">{group.pending} pending</span
                    >{/if}
                  {#if group.silenced > 0}<span class="text-slate-400"
                      >{group.silenced} silenced</span
                    >{/if}
                  {#if group.oldest}<span>oldest: {formatDate(group.oldest)}</span>{/if}
                </div>
              </div>
              <TableSurface maxHeightClass="">
                <Table.Table>
                  <Table.TableHeader>
                    <Table.TableRow>
                      <Table.TableHead></Table.TableHead>
                      <Table.TableHead>State</Table.TableHead>
                      <Table.TableHead>Severity</Table.TableHead>
                      <Table.TableHead>Alertname</Table.TableHead>
                      <Table.TableHead>Since</Table.TableHead>
                      <Table.TableHead>Target</Table.TableHead>
                      <Table.TableHead>Receiver</Table.TableHead>
                      <Table.TableHead>Summary</Table.TableHead>
                      <Table.TableHead>Actions</Table.TableHead>
                    </Table.TableRow>
                  </Table.TableHeader>
                  <Table.TableBody>
                    {#each group.items as alert (alert.id)}
                      {@const builtinRb = lookupRunbook(alert.alertname)}
                      {@const runbook = alert.runbookUrl || builtinRb}
                      <Table.TableRow>
                        <Table.TableCell>
                          <button
                            type="button"
                            class="text-muted-foreground hover:text-foreground"
                            onclick={() =>
                              (expandedAlertId = expandedAlertId === alert.id ? null : alert.id)}
                            title="Toggle details"
                          >
                            {#if expandedAlertId === alert.id}
                              <ChevronDown class="h-3.5 w-3.5" />
                            {:else}
                              <ChevronRight class="h-3.5 w-3.5" />
                            {/if}
                          </button>
                        </Table.TableCell>
                        <Table.TableCell>
                          <span
                            class="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium {stateClass[
                              alert.state
                            ]}"
                          >
                            <span class="font-semibold">{stateIcons[alert.state]}</span>
                            {alert.state}
                          </span>
                        </Table.TableCell>
                        <Table.TableCell>
                          <Badge class="text-white {severityStyles[alert.severity]}"
                            >{alert.severity}</Badge
                          >
                        </Table.TableCell>
                        <Table.TableCell>{alert.alertname}</Table.TableCell>
                        <Table.TableCell>{formatDate(alert.since)}</Table.TableCell>
                        <Table.TableCell>
                          {#if alert.namespace || alert.pod || alert.node}
                            <button
                              type="button"
                              class="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              onclick={() => {
                                if (alert.pod) jumpToResource("pod", alert.pod, alert.namespace);
                                else if (alert.node) jumpToResource("node", alert.node, undefined);
                                else if (alert.namespace)
                                  jumpToResource("namespace", alert.namespace, undefined);
                              }}
                            >
                              {alert.namespace ?? ""}{alert.namespace && (alert.pod || alert.node)
                                ? "/"
                                : ""}{alert.pod ?? alert.node ?? ""}
                              <ExternalLink class="h-3 w-3" />
                            </button>
                          {:else}
                            <span class="text-xs text-muted-foreground">-</span>
                          {/if}
                        </Table.TableCell>
                        <Table.TableCell>{alert.receiver ?? "-"}</Table.TableCell>
                        <Table.TableCell>
                          <p class="text-sm font-medium text-foreground">{alert.summary ?? "-"}</p>
                          <p class="line-clamp-2 text-xs text-muted-foreground">
                            {alert.description ?? ""}
                          </p>
                          {#if runbook}
                            <a
                              class="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1"
                              href={runbook}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open runbook{alert.runbookUrl ? "" : " (built-in)"}
                              <ExternalLink class="h-3 w-3" />
                            </a>
                          {/if}
                        </Table.TableCell>
                        <Table.TableCell>
                          <div class="flex flex-col gap-1 text-xs">
                            {#if alert.state === "silenced" && alert.silenceEndsAt}
                              <span class="text-muted-foreground"
                                >Silence ends {formatDate(alert.silenceEndsAt)}</span
                              >
                            {/if}
                            {#if alert.source === "alertmanager" && alert.state !== "silenced"}
                              <Button
                                size="sm"
                                variant="outline"
                                onclick={() => openSilenceForm(alert)}
                              >
                                Silence
                              </Button>
                            {/if}
                            <Button
                              size="sm"
                              variant="ghost"
                              class="h-6 text-[10px]"
                              onclick={() => copyAlertAsMarkdown(alert)}
                            >
                              <Copy class="mr-1 h-3 w-3" /> Copy MD
                            </Button>
                          </div>
                        </Table.TableCell>
                      </Table.TableRow>
                      {#if expandedAlertId === alert.id}
                        <Table.TableRow>
                          <Table.TableCell colspan={9} class="bg-muted/20">
                            <div class="grid gap-3 md:grid-cols-2 p-2">
                              <div>
                                <p class="text-[10px] font-semibold text-muted-foreground mb-1">
                                  Labels
                                </p>
                                <table class="w-full text-[11px]">
                                  <tbody>
                                    {#each Object.entries(alert.labels) as [k, v]}
                                      <tr class="border-b border-border/30">
                                        <td class="py-0.5 pr-2 font-mono text-muted-foreground"
                                          >{k}</td
                                        >
                                        <td class="py-0.5 font-mono text-foreground">{v}</td>
                                      </tr>
                                    {/each}
                                  </tbody>
                                </table>
                              </div>
                              <div>
                                <p class="text-[10px] font-semibold text-muted-foreground mb-1">
                                  Annotations
                                </p>
                                <table class="w-full text-[11px]">
                                  <tbody>
                                    {#each Object.entries(alert.annotations) as [k, v]}
                                      <tr class="border-b border-border/30">
                                        <td class="py-0.5 pr-2 font-mono text-muted-foreground"
                                          >{k}</td
                                        >
                                        <td class="py-0.5 text-foreground">{v}</td>
                                      </tr>
                                    {/each}
                                  </tbody>
                                </table>
                                {#if alert.source === "prometheus" || alert.source === "alertmanager"}
                                  {@const expr =
                                    alert.labels["__expr__"] ?? alert.annotations["expr"] ?? ""}
                                  {#if expr}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      class="mt-2 h-6 text-[10px]"
                                      onclick={() => openInPrometheus(expr)}
                                    >
                                      <Copy class="mr-1 h-3 w-3" /> Copy Prometheus URL
                                    </Button>
                                  {/if}
                                {/if}
                              </div>
                            </div>
                          </Table.TableCell>
                        </Table.TableRow>
                      {/if}
                    {/each}
                  </Table.TableBody>
                </Table.Table>
              </TableSurface>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Silence form modal (inline) -->
      {#if silenceFormOpen}
        <div class="rounded-lg border border-primary/50 bg-primary/5 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold">Create silence</p>
            <Button size="sm" variant="ghost" onclick={() => (silenceFormOpen = false)}
              >Close</Button
            >
          </div>
          <div class="grid gap-2 md:grid-cols-2">
            <div class="space-y-1">
              <label for="s-alertname" class="text-[11px] text-muted-foreground">alertname</label>
              <Input id="s-alertname" bind:value={silenceDraft.alertname} />
            </div>
            <div class="space-y-1">
              <label for="s-ns" class="text-[11px] text-muted-foreground"
                >namespace (optional)</label
              >
              <Input id="s-ns" bind:value={silenceDraft.namespace} />
            </div>
            <div class="space-y-1">
              <label for="s-dur" class="text-[11px] text-muted-foreground">Duration</label>
              <select
                id="s-dur"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                bind:value={silenceDraft.durationHours}
              >
                <option value={1}>1 hour</option>
                <option value={4}>4 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
              </select>
            </div>
            <div class="space-y-1">
              <label for="s-author" class="text-[11px] text-muted-foreground">Author</label>
              <Input id="s-author" bind:value={silenceDraft.author} />
            </div>
            <div class="space-y-1 md:col-span-2">
              <label for="s-comment" class="text-[11px] text-muted-foreground"
                >Comment (required)</label
              >
              <Input
                id="s-comment"
                bind:value={silenceDraft.comment}
                placeholder="Why this silence? (incident ID, scheduled maintenance)"
              />
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <p class="text-[11px] text-muted-foreground">Extra matchers (label=value pairs)</p>
              <Button size="sm" variant="ghost" onclick={addMatcher}>+ Add matcher</Button>
            </div>
            {#each silenceDraft.extraMatchers as matcher, idx}
              <div class="flex items-center gap-2">
                <Input placeholder="label" bind:value={matcher.name} class="max-w-[200px]" />
                <span class="text-muted-foreground">=</span>
                <Input placeholder="value" bind:value={matcher.value} />
                <Button size="sm" variant="ghost" onclick={() => removeMatcher(idx)}>Remove</Button>
              </div>
            {/each}
          </div>
          <div class="flex flex-wrap gap-2">
            <Button onclick={submitSilence}>Apply silence (local)</Button>
            <Button
              variant="outline"
              onclick={() => copyText(silenceCurlCommand(), "curl command")}
            >
              <Copy class="mr-2 h-3 w-3" /> Copy curl for Alertmanager
            </Button>
          </div>
          <p class="text-[10px] text-muted-foreground">
            "Apply silence" marks the alert silenced in this UI. For the real Alertmanager, copy the
            curl command and run it against your port-forwarded API.
          </p>
        </div>
      {/if}
    {/if}

    {#if activeTab === "silences"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          Silenced alerts in the current feed. For authoritative silence management use the
          Alertmanager UI (`kubectl port-forward -n monitoring svc/alertmanager 9093:9093`).
        </p>
        {#if silencedAlerts.length === 0}
          <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
            No silenced alerts.
          </div>
        {:else}
          <div class="overflow-auto rounded border border-border">
            <table class="w-full text-xs">
              <thead class="bg-muted/30 text-left text-muted-foreground">
                <tr>
                  <th class="px-2 py-1.5 font-normal">Alertname</th>
                  <th class="px-2 py-1.5 font-normal">Severity</th>
                  <th class="px-2 py-1.5 font-normal">Namespace</th>
                  <th class="px-2 py-1.5 font-normal">Silenced since</th>
                  <th class="px-2 py-1.5 font-normal">Ends at</th>
                  <th class="px-2 py-1.5 font-normal">Silence ID</th>
                </tr>
              </thead>
              <tbody>
                {#each silencedAlerts as a (a.id)}
                  <tr class="border-t border-border">
                    <td class="px-2 py-1 font-mono">{a.alertname}</td>
                    <td class="px-2 py-1">
                      <span
                        class="rounded px-1 py-0.5 text-[10px] text-white {severityStyles[
                          a.severity
                        ]}">{a.severity}</span
                      >
                    </td>
                    <td class="px-2 py-1">{a.namespace ?? "-"}</td>
                    <td class="px-2 py-1">{formatDate(a.since)}</td>
                    <td class="px-2 py-1">{formatDate(a.silenceEndsAt ?? null)}</td>
                    <td class="px-2 py-1 font-mono text-[10px] text-muted-foreground"
                      >{a.silenceId ?? "-"}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}

    {#if activeTab === "rules"}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={fetchRules}
          loading={rulesLoading}
          loadingLabel="Loading"
        >
          <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <input
          class="h-8 w-[260px] rounded border border-input bg-background px-2 text-xs"
          placeholder="Search rules by name, expr, severity..."
          bind:value={rulesSearch}
        />
        <span class="text-xs text-muted-foreground">{filteredRules.length} of {rules.length}</span>
      </div>

      {#if rulesError}
        {@const he = humanizeAlertError(rulesError)}
        <Alert.Root variant="destructive">
          <Alert.Title>{he.title}</Alert.Title>
          <Alert.Description>
            {#if he.hint}<p class="mb-1">{he.hint}</p>{/if}
            <pre class="whitespace-pre-wrap text-xs">{rulesError}</pre>
          </Alert.Description>
        </Alert.Root>
      {:else if filteredRules.length === 0 && !rulesLoading}
        <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
          {rules.length === 0
            ? "No PrometheusRule resources. Install Prometheus Operator or add rules to start."
            : "No rules match the current search."}
        </div>
      {:else}
        <div class="space-y-2">
          {#each filteredRules as r, i (r.namespace + "/" + r.group + "/" + r.name + "#" + i)}
            <div class="rounded border border-border p-2.5 text-xs space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-foreground font-mono">{r.name}</span>
                {#if r.severity}
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] text-white {severityStyles[
                      r.severity as AlertSeverity
                    ] ?? 'bg-slate-500'}">{r.severity}</span
                  >
                {/if}
                <span class="text-[10px] text-muted-foreground"
                  >ns: {r.namespace} / group: {r.group}</span
                >
                {#if r.forPeriod}
                  <span class="text-[10px] text-muted-foreground">for: {r.forPeriod}</span>
                {/if}
                {#if lookupRunbook(r.name)}
                  <a
                    class="text-[10px] text-primary hover:underline inline-flex items-center gap-1 ml-auto"
                    href={lookupRunbook(r.name)!}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Runbook <ExternalLink class="h-3 w-3" />
                  </a>
                {/if}
              </div>
              {#if r.summary}
                <p class="text-foreground">{r.summary}</p>
              {/if}
              {#if r.description}
                <p class="text-muted-foreground">{r.description}</p>
              {/if}
              {#if r.expr}
                <pre
                  class="mt-1 rounded bg-muted/30 p-1.5 text-[10px] overflow-x-auto">{r.expr}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    {#if activeTab === "events"}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={fetchEvents}
          loading={eventsLoading}
          loadingLabel="Loading"
        >
          <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <input
          class="h-8 w-[260px] rounded border border-input bg-background px-2 text-xs"
          placeholder="Search events by reason, kind, name..."
          bind:value={eventsSearch}
        />
        <span class="text-xs text-muted-foreground"
          >{filteredEvents.length} of {events.length} Warning events</span
        >
      </div>

      {#if eventsError}
        {@const he = humanizeAlertError(eventsError)}
        <Alert.Root variant="destructive">
          <Alert.Title>{he.title}</Alert.Title>
          <Alert.Description>
            {#if he.hint}<p class="mb-1">{he.hint}</p>{/if}
            <pre class="whitespace-pre-wrap text-xs">{eventsError}</pre>
          </Alert.Description>
        </Alert.Root>
      {:else if filteredEvents.length === 0 && !eventsLoading}
        <div class="rounded border border-dashed p-4 text-sm text-muted-foreground text-center">
          {events.length === 0
            ? "No Warning events. Cluster is quiet."
            : "No events match the current search."}
        </div>
      {:else}
        <div class="overflow-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-normal">Last</th>
                <th class="px-2 py-1.5 font-normal">Reason</th>
                <th class="px-2 py-1.5 font-normal">Object</th>
                <th class="px-2 py-1.5 font-normal">Count</th>
                <th class="px-2 py-1.5 font-normal">Message</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredEvents.slice(0, 500) as e, i (e.namespace + "/" + e.name + "#" + i)}
                <tr class="border-t border-border">
                  <td class="px-2 py-1 text-[10px]">{formatDate(e.lastTimestamp)}</td>
                  <td class="px-2 py-1 font-mono text-amber-400">{e.reason}</td>
                  <td class="px-2 py-1 text-[10px]">
                    <button
                      class="hover:underline"
                      onclick={() => jumpToResource(e.kind, e.objectName, e.namespace)}
                    >
                      {e.kind}/{e.objectName}
                      <span class="text-muted-foreground">in {e.namespace}</span>
                    </button>
                  </td>
                  <td class="px-2 py-1 font-mono">{e.count}</td>
                  <td class="px-2 py-1 text-muted-foreground">{e.message}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if filteredEvents.length > 500}
            <p class="p-2 text-[10px] text-muted-foreground">
              Showing first 500 of {filteredEvents.length}.
            </p>
          {/if}
        </div>
      {/if}
    {/if}
  </Card.Content>
</Card.Root>
