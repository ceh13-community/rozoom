<script lang="ts">
  import { onMount } from "svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";

  const autoRun = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));
  import { checkCertificatesHealth, updateClusterCheckPartially } from "$features/check-health";
  import type { CertificatesReport } from "$features/check-health/model/types";
  import {
    scanTlsCertificates,
    type TlsCertScanResult,
  } from "$features/check-health/api/check-tls-certificates";
  import { emitTlsCertNotifications } from "$features/check-health/model/cert-notification-emitter";
  import { humanizeCertError } from "$features/rotate-certs/model/humanize";
  import { daysSeverity } from "$features/rotate-certs/model/severity";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Table from "$shared/ui/table";
  import * as Alert from "$shared/ui/alert";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type CsrItem = {
    name: string;
    status: string;
    requestor: string;
    age: string;
    signer?: string;
  };

  type CertManagerCert = {
    name: string;
    namespace: string;
    ready: string;
    generation: number;
    observedGeneration: number;
    drift: boolean;
    notAfter: string | null;
    daysLeft: number | null;
    error?: string;
  };

  type AuditEntry = {
    ts: string;
    action: string;
    detail: string;
  };

  type AuditKind = "rotate" | "approve-all" | "approve-one";

  const AUDIT_NAMESPACE = "kube-system";
  const AUDIT_CM_NAME = "rozoom-cert-rotation-audit";
  const AUDIT_CM_KEY = "entries.json";

  let report = $state<CertificatesReport | null>(null);
  let tlsScanResult = $state<TlsCertScanResult | null>(null);
  let tlsLoading = $state(false);
  let loading = $state(false);
  let rotating = $state(false);
  let approvingCsrs = $state(false);
  let rotateResult = $state<{ ok: boolean; message: string } | null>(null);
  let distributionHint = $state<string | null>(null);
  let pendingCsrs = $state<CsrItem[]>([]);
  let allCsrs = $state<CsrItem[]>([]);
  let certManagerCerts = $state<CertManagerCert[]>([]);
  let certManagerLoading = $state(false);
  let certManagerError = $state<string | null>(null);
  let auditLog = $state<AuditEntry[]>([]);
  let filterType = $state<"all" | "critical" | "warning">("all");
  let wizardOpen = $state(false);

  const certificates = $derived(report?.certificates ?? []);
  const kubeletRotation = $derived(report?.kubeletRotation ?? []);
  const summary = $derived(report?.summary ?? null);
  const hasExpired = $derived(certificates.some((c) => c.status === "critical"));
  const allOk = $derived(certificates.length > 0 && certificates.every((c) => c.status === "ok"));
  const updatedAtText = $derived(
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  function statusBadge(status: string): string {
    if (status === "ok" || status === "enabled" || status === "Approved")
      return "bg-emerald-600 text-white";
    if (status === "warning" || status === "Pending") return "bg-amber-500 text-black";
    if (status === "critical" || status === "disabled" || status === "Denied")
      return "bg-rose-600 text-white";
    return "bg-slate-500 text-white";
  }

  function formatDays(days?: number): string {
    if (days === undefined || !Number.isFinite(days)) return "-";
    const d = Math.floor(days);
    if (d < 0) return `expired ${Math.abs(d)}d ago`;
    return `${d}d`;
  }

  function formatRelativeAge(value: string | number | null): string {
    if (value === null || value === undefined) return "-";
    const ts = typeof value === "number" ? value : Date.parse(value);
    if (Number.isNaN(ts)) return "-";
    const diffMs = Date.now() - ts;
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    rotateResult = null;
    try {
      await detectDistribution();
      await fetchCsrs();
      await fetchCertManagerCerts();
      await fetchAuditLog();
      const fresh = await checkCertificatesHealth(clusterId, { force: true });
      report = fresh;
      await updateClusterCheckPartially(clusterId, { certificatesHealth: fresh });
    } catch {
      // cert check may fail on some distributions, that's ok
    } finally {
      loading = false;
    }
  }

  async function detectDistribution() {
    try {
      // Gather node names + server version in parallel
      const [nodesRes, versionRes] = await Promise.all([
        kubectlRawFront("get nodes -o jsonpath='{.items[*].metadata.name}'", {
          clusterId,
          source: "rotate-certs:detect-distro",
        }),
        kubectlRawFront("version -o json", { clusterId, source: "rotate-certs:detect-version" }),
      ]);

      const nodeNames = (nodesRes.output?.replace(/'/g, "") ?? "").trim().toLowerCase();
      const versionJson = JSON.parse(versionRes.output || "{}");
      const sv = (versionJson?.serverVersion?.gitVersion ?? "").toLowerCase();
      const platform = (versionJson?.serverVersion?.platform ?? "").toLowerCase();

      // Local runtimes (by node name)
      if (nodeNames === "minikube" || nodeNames.startsWith("minikube ")) {
        distributionHint = "minikube";
      } else if (nodeNames.includes("kind-")) {
        distributionHint = "kind";
      } else if (nodeNames.includes("k3d-")) {
        distributionHint = "k3d";
      } else if (nodeNames === "docker-desktop") {
        distributionHint = "docker-desktop";
      } else if (nodeNames.includes("colima")) {
        distributionHint = "colima";
      } else if (nodeNames.includes("rancher-desktop")) {
        distributionHint = "rancher-desktop";
      }
      // Self-managed (by server version string)
      else if (sv.includes("k3s")) {
        distributionHint = "k3s";
      } else if (sv.includes("rke2")) {
        distributionHint = "rke2";
      }
      // Managed cloud (by server version or platform hints)
      else if (sv.includes("eks") || sv.includes("amazon")) {
        distributionHint = "eks";
      } else if (sv.includes("gke")) {
        distributionHint = "gke";
      } else if (sv.includes("aks")) {
        distributionHint = "aks";
      }
      // Check for OpenShift via API
      else {
        try {
          const ocRes = await kubectlRawFront("api-versions", {
            clusterId,
            source: "rotate-certs:detect-openshift",
          });
          if (ocRes.output?.includes("openshift.io")) {
            distributionHint = "openshift";
          } else {
            // Check for DigitalOcean/Hetzner/OKE via node labels
            const labelsRes = await kubectlRawFront(
              "get nodes -o jsonpath='{.items[0].spec.providerID}'",
              { clusterId, source: "rotate-certs:detect-cloud" },
            );
            const pid = (labelsRes.output?.replace(/'/g, "") ?? "").toLowerCase();
            if (pid.includes("digitalocean")) distributionHint = "doks";
            else if (pid.includes("hetzner") || pid.includes("hcloud"))
              distributionHint = "hetzner";
            else if (pid.includes("oracle") || pid.includes("oke")) distributionHint = "oke";
            else distributionHint = "kubeadm";
          }
        } catch {
          distributionHint = "kubeadm";
        }
      }
    } catch {
      distributionHint = null;
    }
  }

  async function fetchCsrs() {
    try {
      const res = await kubectlRawFront("get csr -o json", {
        clusterId,
        source: "rotate-certs:list-csrs",
      });
      if (res.code !== 0) {
        allCsrs = [];
        pendingCsrs = [];
        return;
      }
      const parsed = JSON.parse(res.output || "{}");
      const items = (parsed.items ?? []) as Array<{
        metadata?: { name?: string; creationTimestamp?: string };
        spec?: { username?: string; signerName?: string };
        status?: { conditions?: Array<{ type?: string }> };
      }>;

      allCsrs = items.map((item) => {
        const conditions = item.status?.conditions ?? [];
        const approved = conditions.some((c) => c.type === "Approved");
        const denied = conditions.some((c) => c.type === "Denied");
        const status = approved ? "Approved" : denied ? "Denied" : "Pending";
        const created = item.metadata?.creationTimestamp;
        let age = "-";
        if (created) {
          const ms = Date.now() - new Date(created).getTime();
          const hours = Math.floor(ms / 3600000);
          const days = Math.floor(hours / 24);
          age = days > 0 ? `${days}d` : `${hours}h`;
        }
        return {
          name: item.metadata?.name ?? "unknown",
          status,
          requestor: item.spec?.username ?? "-",
          age,
          signer: item.spec?.signerName,
        };
      });

      pendingCsrs = allCsrs.filter((c) => c.status === "Pending");
    } catch {
      allCsrs = [];
      pendingCsrs = [];
    }
  }

  async function fetchCertManagerCerts() {
    certManagerLoading = true;
    certManagerError = null;
    try {
      const res = await kubectlRawFront(
        "get certificates.cert-manager.io --all-namespaces -o json --request-timeout=10s",
        { clusterId, source: "rotate-certs:list-cm-certs" },
      );
      if (res.code !== 0) {
        const err = res.errors.toLowerCase();
        if (err.includes("no resources found") || err.includes("doesn't have a resource type")) {
          certManagerCerts = [];
        } else {
          certManagerError = res.errors || `kubectl exited with code ${res.code ?? "unknown"}`;
        }
        return;
      }
      const parsed = JSON.parse(res.output || "{}");
      const items = (parsed.items ?? []) as Array<{
        metadata?: { name?: string; namespace?: string; generation?: number };
        spec?: { secretName?: string };
        status?: {
          observedGeneration?: number;
          notAfter?: string;
          conditions?: Array<{ type?: string; status?: string; message?: string }>;
        };
      }>;
      certManagerCerts = items.map((item) => {
        const name = item.metadata?.name ?? "unknown";
        const namespace = item.metadata?.namespace ?? "default";
        const generation = item.metadata?.generation ?? 0;
        const observed = item.status?.observedGeneration ?? 0;
        const readyCond = item.status?.conditions?.find((c) => c.type === "Ready");
        const ready = readyCond?.status ?? "Unknown";
        const notAfter = item.status?.notAfter ?? null;
        const daysLeft =
          notAfter && !Number.isNaN(Date.parse(notAfter))
            ? Math.floor((Date.parse(notAfter) - Date.now()) / 86_400_000)
            : null;
        return {
          name,
          namespace,
          ready,
          generation,
          observedGeneration: observed,
          drift: generation !== observed || ready !== "True",
          notAfter,
          daysLeft,
          error: ready !== "True" ? (readyCond?.message ?? undefined) : undefined,
        };
      });
    } catch (err) {
      certManagerError = err instanceof Error ? err.message : "Failed to fetch cert-manager certs";
      certManagerCerts = [];
    } finally {
      certManagerLoading = false;
    }
  }

  async function fetchAuditLog() {
    try {
      const res = await kubectlRawFront(
        `get configmap ${AUDIT_CM_NAME} -n ${AUDIT_NAMESPACE} -o json --request-timeout=10s`,
        { clusterId, source: "rotate-certs:audit-read" },
      );
      if (res.code !== 0) {
        auditLog = [];
        return;
      }
      const parsed = JSON.parse(res.output || "{}");
      const raw = parsed?.data?.[AUDIT_CM_KEY];
      if (typeof raw !== "string" || !raw) {
        auditLog = [];
        return;
      }
      const entries = JSON.parse(raw) as AuditEntry[];
      auditLog = Array.isArray(entries) ? entries.slice(-20).reverse() : [];
    } catch {
      auditLog = [];
    }
  }

  async function appendAuditEntry(kind: AuditKind, detail: string) {
    try {
      const entry: AuditEntry = {
        ts: new Date().toISOString(),
        action: kind,
        detail: detail.slice(0, 400),
      };
      const next = [...(auditLog ?? []).slice().reverse(), entry].slice(-50);
      const payload = JSON.stringify(next);
      const patch = JSON.stringify({ data: { [AUDIT_CM_KEY]: payload } });
      const patchArgs = `patch configmap ${AUDIT_CM_NAME} -n ${AUDIT_NAMESPACE} --type merge -p ${JSON.stringify(patch)} --request-timeout=10s`;
      const patchRes = await kubectlRawFront(patchArgs, {
        clusterId,
        source: "rotate-certs:audit-patch",
      });
      if (patchRes.code !== 0) {
        // ConfigMap may not exist yet - create it with the initial payload.
        const createRes = await kubectlRawFront(
          `create configmap ${AUDIT_CM_NAME} -n ${AUDIT_NAMESPACE} --from-literal=${AUDIT_CM_KEY}=${JSON.stringify(payload)} --request-timeout=10s`,
          { clusterId, source: "rotate-certs:audit-create" },
        );
        if (createRes.code !== 0) {
          const humanized = humanizeCertError(createRes.errors || patchRes.errors || "");
          toast.error(
            `Audit trail not persisted: ${humanized.title}. Your action succeeded; only the audit ConfigMap is missing.`,
            { duration: 8000 },
          );
          return;
        }
      }
      await fetchAuditLog();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        `Audit trail write failed: ${message}. Action succeeded, only audit is missing.`,
        {
          duration: 8000,
        },
      );
    }
  }

  const MANAGED_PROVIDERS = new Set(["eks", "gke", "aks", "doks", "hetzner", "oke"]);
  const LOCAL_RUNTIMES = new Set([
    "minikube",
    "kind",
    "k3d",
    "docker-desktop",
    "rancher-desktop",
    "colima",
  ]);

  const isManaged = $derived(MANAGED_PROVIDERS.has(distributionHint ?? ""));
  const isLocal = $derived(LOCAL_RUNTIMES.has(distributionHint ?? ""));

  type RotateStrategy = {
    label: string;
    command: string;
    canAutoRotate: boolean;
  };

  const STRATEGY: Record<string, RotateStrategy> = {
    kubeadm: {
      label: "kubeadm",
      command: "kubeadm certs renew all && systemctl restart kubelet",
      canAutoRotate: true,
    },
    k3s: {
      label: "K3s",
      command: "systemctl restart k3s (master) / k3s-agent (workers)",
      canAutoRotate: false,
    },
    rke2: {
      label: "RKE2",
      command: "systemctl restart rke2-server / rke2-agent",
      canAutoRotate: false,
    },
    openshift: {
      label: "OpenShift",
      command: "oc adm certificate approve <csr>",
      canAutoRotate: true,
    },
    minikube: {
      label: "Minikube",
      command: "minikube stop && minikube start",
      canAutoRotate: false,
    },
    kind: {
      label: "Kind",
      command: "kind delete cluster && kind create cluster",
      canAutoRotate: false,
    },
    k3d: {
      label: "K3d",
      command: "k3d cluster stop <name> && k3d cluster start <name>",
      canAutoRotate: false,
    },
    "docker-desktop": {
      label: "Docker Desktop",
      command: "Reset Kubernetes cluster in Docker Desktop settings",
      canAutoRotate: false,
    },
    "rancher-desktop": {
      label: "Rancher Desktop",
      command: "Reset Kubernetes in Rancher Desktop preferences",
      canAutoRotate: false,
    },
    colima: {
      label: "Colima",
      command: "colima stop && colima start --kubernetes",
      canAutoRotate: false,
    },
    eks: {
      label: "AWS EKS",
      command: "Managed by AWS - certificates rotate automatically",
      canAutoRotate: false,
    },
    gke: {
      label: "GKE",
      command: "Managed by Google - certificates rotate automatically",
      canAutoRotate: false,
    },
    aks: {
      label: "AKS",
      command: "Managed by Azure - certificates rotate automatically",
      canAutoRotate: false,
    },
    doks: {
      label: "DigitalOcean",
      command: "Managed by DigitalOcean - certificates rotate automatically",
      canAutoRotate: false,
    },
    hetzner: {
      label: "Hetzner",
      command: "Managed by Hetzner - certificates rotate automatically",
      canAutoRotate: false,
    },
    oke: {
      label: "Oracle OKE",
      command: "Managed by Oracle - certificates rotate automatically",
      canAutoRotate: false,
    },
  };

  const strategy = $derived(STRATEGY[distributionHint ?? ""] ?? STRATEGY.kubeadm);
  const rotateHint = $derived(strategy.command);

  async function approveAllPendingCsrs(options?: { skipConfirm?: boolean }) {
    if (approvingCsrs || pendingCsrs.length === 0) return;
    if (!options?.skipConfirm) {
      const signerSummary = Array.from(
        new Set(pendingCsrs.map((c) => c.signer ?? "(unknown signer)")),
      )
        .map((s) => `  - ${s}`)
        .join("\n");
      const preview = pendingCsrs
        .slice(0, 10)
        .map((c) => `  - ${c.name} by ${c.requestor} (${c.age})`)
        .join("\n");
      const extra = pendingCsrs.length > 10 ? `\n  ... and ${pendingCsrs.length - 10} more` : "";
      const confirmed = await confirmAction(
        `Approve ${pendingCsrs.length} pending CSR(s)?\n\n` +
          `Signers:\n${signerSummary}\n\n` +
          `Requests:\n${preview}${extra}\n\n` +
          `Approved CSRs immediately get a signed certificate. Only approve CSRs you ` +
          `recognise - auto-approving the wrong kubelet signer can let a node impersonate another.`,
        "Approve all CSRs",
      );
      if (!confirmed) return;
    }
    approvingCsrs = true;
    rotateResult = null;

    const approved: string[] = [];
    const failed: string[] = [];

    for (const csr of pendingCsrs) {
      try {
        const res = await kubectlRawFront(`certificate approve ${csr.name}`, {
          clusterId,
          source: "rotate-certs:approve-csr",
        });
        if (res.code === 0) {
          approved.push(csr.name);
        } else {
          failed.push(`${csr.name}: ${res.errors || "unknown error"}`);
        }
      } catch (e) {
        failed.push(`${csr.name}: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    }

    if (approved.length > 0 && failed.length === 0) {
      rotateResult = {
        ok: true,
        message: `Approved ${approved.length} CSR(s). Certificates should renew shortly.`,
      };
    } else if (approved.length > 0) {
      rotateResult = {
        ok: true,
        message: `Approved ${approved.length} CSR(s). ${failed.length} failed:\n${failed.join("\n")}`,
      };
    } else {
      rotateResult = { ok: false, message: `All CSR approvals failed:\n${failed.join("\n")}` };
    }

    approvingCsrs = false;
    await fetchCsrs();
    void appendAuditEntry(
      "approve-all",
      `approved=${approved.length} failed=${failed.length} signers=${Array.from(
        new Set(pendingCsrs.map((c) => c.signer ?? "?")),
      ).join(",")}`,
    );
  }

  async function rotateCertificates() {
    if (rotating || isManaged) return;
    const confirmed = await confirmAction(
      `Rotate control-plane certificates on this cluster?\n\n` +
        `Target distribution: ${strategy.label}\n` +
        `Strategy: ${strategy.canAutoRotate ? "automatic via kubeadm inside the apiserver pod" : "delete + re-approve CSRs"}\n\n` +
        `This may briefly interrupt the control plane (apiserver, controller-manager, scheduler). ` +
        `If automatic rotation fails, the panel will show the manual command to run.`,
      `Rotate certificates (${strategy.label})`,
    );
    if (!confirmed) return;
    rotating = true;
    rotateResult = null;

    try {
      // Strategy 1: kubeadm exec (works for kubeadm clusters)
      const podsRes = await kubectlRawFront(
        "get pods -n kube-system -l component=kube-apiserver -o jsonpath='{.items[0].metadata.name}'",
        { clusterId, source: "rotate-certs:find-cp-pod" },
      );
      const cpPod = podsRes.output?.replace(/'/g, "").trim();

      if (cpPod) {
        const execRes = await kubectlRawFront(
          `exec -n kube-system ${cpPod} -- kubeadm certs renew all`,
          { clusterId, source: "rotate-certs:renew" },
        );

        if (execRes.code === 0) {
          rotateResult = {
            ok: true,
            message:
              "Certificates renewed via kubeadm.\nRestart kubelet on each node: systemctl restart kubelet",
          };
          await refresh();
          return;
        }
      }

      // Strategy 2: delete and re-approve CSRs (works for minikube/kind/any)
      // First try to trigger new CSR by deleting kubelet client cert CSRs
      const csrDeleteRes = await kubectlRawFront(
        "delete csr --field-selector spec.signerName=kubernetes.io/kubelet-serving -l auto-renewed!=true",
        { clusterId, source: "rotate-certs:delete-old-csrs" },
      );

      // Check for new pending CSRs
      await new Promise((r) => setTimeout(r, 2000));
      await fetchCsrs();

      if (pendingCsrs.length > 0) {
        await approveAllPendingCsrs();
        return;
      }

      // Fallback: show manual instructions
      rotateResult = {
        ok: false,
        message: `Automatic rotation not available for this cluster type.\n\nManual command:\n${rotateHint}\n\nAfter running the command, click "Check now" to verify.`,
      };
    } catch (error) {
      rotateResult = {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unexpected error during certificate rotation.",
      };
    } finally {
      rotating = false;
      void appendAuditEntry(
        "rotate",
        `strategy=${strategy.label} ok=${rotateResult?.ok ?? false} detail=${(rotateResult?.message ?? "").replace(/\n/g, " ").slice(0, 200)}`,
      );
    }
  }

  async function scanTls(options?: { force?: boolean }) {
    tlsLoading = true;
    try {
      tlsScanResult = await scanTlsCertificates(clusterId, options);
      emitTlsCertNotifications(clusterId, clusterId, tlsScanResult.certs);
    } catch {
      tlsScanResult = null;
    } finally {
      tlsLoading = false;
    }
  }

  onMount(() => {
    if (autoRun) {
      void refresh();
    }
    void scanTls();
  });

  const SCAN_TTL_MS = 24 * 60 * 60 * 1000;
  const scanFreshness = $derived.by<{
    ageMs: number | null;
    severity: "ok" | "warning" | "critical";
    label: string;
  }>(() => {
    const updated = report?.updatedAt;
    if (updated === undefined || updated === null)
      return { ageMs: null, severity: "critical", label: "Never scanned" };
    const ts = typeof updated === "number" ? updated : Date.parse(updated);
    if (Number.isNaN(ts)) return { ageMs: null, severity: "critical", label: "Unknown" };
    const ageMs = Date.now() - ts;
    const pct = ageMs / SCAN_TTL_MS;
    const relative = formatRelativeAge(updated);
    if (pct >= 1) return { ageMs, severity: "critical", label: `${relative} (stale)` };
    if (pct >= 0.75) return { ageMs, severity: "warning", label: `${relative} (ageing)` };
    return { ageMs, severity: "ok", label: relative };
  });

  const visibleCertificates = $derived(
    filterType === "all"
      ? certificates
      : filterType === "critical"
        ? certificates.filter((c) => {
            const d = c.daysLeft;
            return typeof d === "number" && d <= 7;
          })
        : certificates.filter((c) => {
            const d = c.daysLeft;
            return typeof d === "number" && d > 7 && d <= 30;
          }),
  );

  const cmDriftCount = $derived(certManagerCerts.filter((c) => c.drift).length);

  function openHelmPage() {
    if (typeof window === "undefined") return;
    const next = new URL($page.url);
    next.searchParams.set("workload", "helm");
    void goto(next.pathname + next.search);
  }
</script>

<div class="space-y-4 p-1">
  {#if scanFreshness.severity !== "ok"}
    <div
      class={`rounded-md border px-3 py-2 text-xs ${
        scanFreshness.severity === "critical"
          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      <div class="flex items-center justify-between gap-2">
        <span>
          <span class="font-semibold">Scan freshness:</span>
          {scanFreshness.label}. Data auto-refreshes every 24h; re-run if you just rotated.
        </span>
        <Button
          variant="outline"
          size="sm"
          class="h-6 text-[11px]"
          onclick={refresh}
          disabled={loading}
        >
          {loading ? "Scanning…" : "Refresh now"}
        </Button>
      </div>
    </div>
  {/if}

  <DiagnosticSummaryCard title="Certificate Rotation">
    <div class="flex items-center justify-between gap-2">
      <div>
        <p class="text-xs text-muted-foreground">
          {summary?.message ?? "Run a scan to check certificate status."}
        </p>
        {#if summary?.warnings?.length}
          {#each summary.warnings as w}
            <p class="text-xs text-amber-400 mt-1">{w}</p>
          {/each}
        {/if}
        <p class="text-[10px] text-muted-foreground mt-1">
          Last checked: {updatedAtText} ({scanFreshness.label})
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={() => (wizardOpen = true)}
          disabled={!distributionHint}
          title="Open a step-by-step rotation wizard for your cluster distribution"
        >
          Rotation wizard
        </Button>
        <Button variant="outline" size="sm" onclick={refresh} {loading} loadingLabel="Scanning">
          Check now
        </Button>
      </div>
    </div>
  </DiagnosticSummaryCard>

  {#if distributionHint}
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium">Cluster Distribution</Card.Title>
      </Card.Header>
      <Card.Content class="text-sm">
        <div class="flex items-center gap-2 flex-wrap">
          <Badge class="bg-blue-600 text-white">{strategy.label}</Badge>
          {#if isManaged}
            <span class="text-muted-foreground"
              >Certificates are managed by the cloud provider.</span
            >
          {:else if isLocal}
            <span class="text-muted-foreground"
              >Local cluster - restart to regenerate certificates:</span
            >
          {:else}
            <span class="text-muted-foreground">Rotation command:</span>
          {/if}
        </div>
        {#if !isManaged}
          <code class="mt-2 block text-xs bg-muted px-2 py-1.5 rounded font-mono">{rotateHint}</code
          >
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if rotateResult}
    {@const humanized = rotateResult.ok ? null : humanizeCertError(rotateResult.message)}
    <Alert.Root variant={rotateResult.ok ? "default" : "destructive"}>
      <Alert.Title
        >{rotateResult.ok
          ? "Success"
          : humanized && humanized.title !== "Certificate action failed"
            ? humanized.title
            : "Rotation Failed"}</Alert.Title
      >
      <Alert.Description class="text-xs whitespace-pre-wrap">
        {#if humanized?.hint}
          <p class="mb-1 font-medium">{humanized.hint}</p>
        {/if}
        {rotateResult.message}
      </Alert.Description>
    </Alert.Root>
  {/if}

  <!-- Pending CSRs -->
  {#if allCsrs.length > 0}
    <Card.Root>
      <Card.Header class="pb-2">
        <div class="flex items-center justify-between">
          <div>
            <Card.Title class="text-sm font-medium">Certificate Signing Requests</Card.Title>
            <Card.Description class="text-xs">
              {pendingCsrs.length > 0
                ? `${pendingCsrs.length} pending CSR(s) - approve to issue new certificates.`
                : `${allCsrs.length} CSR(s) found, none pending.`}
            </Card.Description>
          </div>
          {#if pendingCsrs.length > 0}
            <Button
              variant="default"
              size="sm"
              onclick={approveAllPendingCsrs}
              loading={approvingCsrs}
              loadingLabel="Approving"
              disabled={offline}
            >
              Approve All ({pendingCsrs.length})
            </Button>
          {/if}
        </div>
      </Card.Header>
      <Card.Content>
        <TableSurface>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Name</Table.Head>
                <Table.Head>Requestor</Table.Head>
                <Table.Head class="text-center">Age</Table.Head>
                <Table.Head class="text-right">Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each allCsrs.slice(0, 20) as csr (csr.name)}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs max-w-[200px] truncate"
                    >{csr.name}</Table.Cell
                  >
                  <Table.Cell class="text-xs text-muted-foreground">{csr.requestor}</Table.Cell>
                  <Table.Cell class="text-center text-xs">{csr.age}</Table.Cell>
                  <Table.Cell class="text-right">
                    <Badge class={`text-[10px] ${statusBadge(csr.status)}`}>{csr.status}</Badge>
                  </Table.Cell>
                </Table.Row>
              {/each}
              {#if allCsrs.length > 20}
                <Table.Row>
                  <Table.Cell colspan={4} class="text-center text-xs text-muted-foreground">
                    ... and {allCsrs.length - 20} more
                  </Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </TableSurface>
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Control-plane certificates -->
  <Card.Root>
    <Card.Header class="pb-2">
      <div class="flex items-center justify-between gap-2">
        <Card.Title class="text-sm font-medium">Control-Plane Certificates</Card.Title>
        <div class="flex items-center gap-2">
          {#if certificates.length > 0}
            <div class="inline-flex items-center rounded border border-border">
              <button
                type="button"
                class={`px-2 py-1 text-[11px] ${filterType === "all" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
                onclick={() => (filterType = "all")}
              >
                All ({certificates.length})
              </button>
              <button
                type="button"
                class={`border-l border-border px-2 py-1 text-[11px] ${filterType === "critical" ? "bg-rose-500/10 font-medium text-rose-300" : "text-muted-foreground hover:bg-muted/50"}`}
                onclick={() => (filterType = "critical")}
              >
                Critical (≤7d)
              </button>
              <button
                type="button"
                class={`border-l border-border px-2 py-1 text-[11px] ${filterType === "warning" ? "bg-amber-500/10 font-medium text-amber-300" : "text-muted-foreground hover:bg-muted/50"}`}
                onclick={() => (filterType = "warning")}
              >
                Warning (8–30d)
              </button>
            </div>
          {/if}
          {#if !isManaged && (certificates.length > 0 || pendingCsrs.length > 0)}
            <Button
              variant={hasExpired ? "destructive" : "outline"}
              size="sm"
              onclick={rotateCertificates}
              loading={rotating}
              loadingLabel="Rotating"
              disabled={offline || isManaged}
            >
              {hasExpired ? "Rotate Now" : "Renew All"}
            </Button>
          {/if}
        </div>
      </div>
    </Card.Header>
    <Card.Content>
      {#if loading && certificates.length === 0}
        <div class="text-center py-6 text-muted-foreground text-sm">
          <LoadingDots /> Scanning certificates...
        </div>
      {:else if certificates.length === 0}
        <TableEmptyState
          message={isManaged
            ? "Managed cloud clusters rotate control-plane certs for you automatically - nothing to show."
            : isLocal
              ? "Local runtimes (minikube/kind/etc.) regenerate certs on restart - nothing to rotate here."
              : "No control-plane certificate data available. Click Check now to scan."}
        />
      {:else if visibleCertificates.length === 0}
        <TableEmptyState
          message={`No certificates match the "${filterType}" filter. Clear to see all ${certificates.length}.`}
        />
      {:else}
        <TableSurface>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Certificate</Table.Head>
                <Table.Head>Expires</Table.Head>
                <Table.Head class="text-right">Days Left</Table.Head>
                <Table.Head class="text-right">Urgency</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each visibleCertificates as cert (cert.name)}
                {@const sev = daysSeverity(cert.daysLeft ?? undefined)}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{cert.name}</Table.Cell>
                  <Table.Cell class="text-xs text-muted-foreground">
                    {cert.expiresAt ?? "-"}
                  </Table.Cell>
                  <Table.Cell class="text-right text-xs font-medium">
                    {formatDays(cert.daysLeft)}
                  </Table.Cell>
                  <Table.Cell class="text-right" title={sev.tooltip}>
                    <Badge class={`text-[10px] ${sev.badge}`}>
                      {sev.label.toUpperCase()}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </TableSurface>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- cert-manager drift -->
  {#if certManagerCerts.length > 0 || certManagerError}
    <Card.Root>
      <Card.Header class="pb-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <Card.Title class="text-sm font-medium">
              cert-manager Certificates
              {#if cmDriftCount > 0}
                <Badge class="ml-2 bg-rose-600 text-[10px] text-white">
                  {cmDriftCount} drift
                </Badge>
              {/if}
            </Card.Title>
            <Card.Description class="text-xs">
              cert-manager Certificate CRs that issue the TLS Secrets for Ingresses and workloads.
              "Drift" = spec changed but controller has not reconciled yet, or the renewal is
              failing.
            </Card.Description>
          </div>
          {#if certManagerError || cmDriftCount > 0}
            <Button
              variant="outline"
              size="sm"
              onclick={openHelmPage}
              title="Open Helm page - cert-manager outdated charts may be the root cause"
            >
              Check Helm version
            </Button>
          {/if}
        </div>
      </Card.Header>
      <Card.Content>
        {#if certManagerError}
          {@const humanized = humanizeCertError(certManagerError)}
          <div
            class="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
          >
            <p class="font-medium">{humanized.title}</p>
            {#if humanized.hint}
              <p class="text-[11px] opacity-80">{humanized.hint}</p>
            {/if}
          </div>
        {/if}
        {#if certManagerCerts.length === 0}
          <TableEmptyState
            message="cert-manager is not installed, or no Certificate resources exist."
          />
        {:else}
          <TableSurface>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Name</Table.Head>
                  <Table.Head>Namespace</Table.Head>
                  <Table.Head class="text-center">Ready</Table.Head>
                  <Table.Head class="text-center">Gen/Observed</Table.Head>
                  <Table.Head class="text-right">Days left</Table.Head>
                  <Table.Head class="text-right">Urgency</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each certManagerCerts as c (c.namespace + "/" + c.name)}
                  {@const sev = daysSeverity(c.daysLeft ?? undefined)}
                  <Table.Row class={c.drift ? "bg-amber-500/5" : ""}>
                    <Table.Cell class="font-mono text-xs">{c.name}</Table.Cell>
                    <Table.Cell class="text-xs">{c.namespace}</Table.Cell>
                    <Table.Cell class="text-center">
                      <Badge
                        class={`text-[10px] ${
                          c.ready === "True"
                            ? "bg-emerald-600 text-white"
                            : c.ready === "False"
                              ? "bg-rose-600 text-white"
                              : "bg-slate-500 text-white"
                        }`}
                      >
                        {c.ready}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell
                      class={`text-center text-xs ${c.drift ? "text-amber-400" : "text-muted-foreground"}`}
                      title={c.drift
                        ? "Certificate generation differs from observedGeneration - controller has not reconciled yet"
                        : "In sync"}
                    >
                      {c.generation}/{c.observedGeneration}
                    </Table.Cell>
                    <Table.Cell class="text-right text-xs font-medium">
                      {c.daysLeft === null ? "-" : formatDays(c.daysLeft)}
                    </Table.Cell>
                    <Table.Cell class="text-right" title={sev.tooltip}>
                      <Badge class={`text-[10px] ${sev.badge}`}>
                        {sev.label.toUpperCase()}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </TableSurface>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Kubelet rotation status -->
  <Card.Root>
    <Card.Header class="pb-2">
      <Card.Title class="text-sm font-medium">Kubelet Certificate Rotation</Card.Title>
      <Card.Description class="text-xs">
        Whether each node has automatic client and server certificate rotation enabled.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      {#if loading && kubeletRotation.length === 0}
        <div class="text-center py-6 text-muted-foreground text-sm">
          <LoadingDots /> Checking nodes...
        </div>
      {:else if kubeletRotation.length === 0}
        <TableEmptyState message="No node rotation data available." />
      {:else}
        <TableSurface>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Node</Table.Head>
                <Table.Head class="text-center">Client Rotation</Table.Head>
                <Table.Head class="text-center">Server Rotation</Table.Head>
                <Table.Head class="text-right">Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each kubeletRotation as node (node.node)}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{node.node}</Table.Cell>
                  <Table.Cell class="text-center text-xs">
                    {node.rotateClient === true ? "Yes" : node.rotateClient === false ? "No" : "-"}
                  </Table.Cell>
                  <Table.Cell class="text-center text-xs">
                    {node.rotateServer === true ? "Yes" : node.rotateServer === false ? "No" : "-"}
                  </Table.Cell>
                  <Table.Cell class="text-right">
                    <Badge class={`text-[10px] ${statusBadge(node.status)}`}>
                      {node.status.toUpperCase()}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </TableSurface>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if allOk && !isManaged && pendingCsrs.length === 0}
    <Alert.Root>
      <Alert.Title>All certificates healthy</Alert.Title>
      <Alert.Description class="text-xs">
        No action required. Certificates will be checked automatically every 24 hours.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <!-- Rotation audit log -->
  {#if auditLog.length > 0}
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-medium">Rotation audit trail</Card.Title>
        <Card.Description class="text-xs">
          Persisted in <code class="font-mono">configmap/{AUDIT_CM_NAME}</code> in
          <code class="font-mono">{AUDIT_NAMESPACE}</code>. Newest first.
        </Card.Description>
      </Card.Header>
      <Card.Content class="p-0">
        <TableSurface maxHeightClass="max-h-80">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>When</Table.Head>
                <Table.Head>Action</Table.Head>
                <Table.Head>Detail</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each auditLog as entry (entry.ts + entry.action)}
                <Table.Row>
                  <Table.Cell class="whitespace-nowrap font-mono text-xs">
                    {formatRelativeAge(entry.ts)}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge class="bg-slate-500 text-[10px] text-white">{entry.action}</Badge>
                  </Table.Cell>
                  <Table.Cell class="text-xs text-muted-foreground">{entry.detail}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </TableSurface>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

{#if wizardOpen}
  {@const wizardProvider = distributionHint ?? "kubeadm"}
  <button
    type="button"
    class="fixed inset-0 z-[150] bg-black/40"
    aria-label="Close wizard"
    onclick={() => (wizardOpen = false)}
  ></button>
  <div
    class="fixed inset-y-6 right-6 z-[160] flex w-[min(70vw,720px)] flex-col rounded-lg border bg-background shadow-2xl"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div>
        <div class="text-sm font-semibold">
          Rotation wizard — <span class="text-sky-400">{strategy.label}</span>
        </div>
        <div class="text-[11px] text-muted-foreground">
          Step-by-step guidance for the detected cluster distribution. Commands are read-only; run
          them in a shell with kubectl access.
        </div>
      </div>
      <Button variant="ghost" size="sm" onclick={() => (wizardOpen = false)}>Close</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4 text-sm">
      {#if isManaged}
        <Alert.Root>
          <Alert.Title>Managed cluster</Alert.Title>
          <Alert.Description class="text-xs">
            {strategy.label} rotates control-plane certificates automatically. You do not need to do
            anything for cp certs. Node kubelet CSRs may still appear and require approval if auto-approver
            is disabled.
          </Alert.Description>
        </Alert.Root>
      {:else if isLocal}
        <div class="space-y-3 text-xs">
          <p class="text-muted-foreground">
            Local runtime — easiest path is to stop and restart the cluster. The CA and certificates
            get regenerated by the runtime.
          </p>
          <ol class="space-y-2 pl-4">
            <li>
              <p class="font-medium text-foreground">1. Stop the cluster</p>
              <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
                >{strategy.command.split("&&")[0]?.trim() ?? strategy.command}</code
              >
            </li>
            <li>
              <p class="font-medium text-foreground">2. Start it again</p>
              <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
                >{strategy.command.split("&&")[1]?.trim() ?? strategy.command}</code
              >
            </li>
            <li>
              <p class="font-medium text-foreground">3. Re-run Check now</p>
              <p class="text-muted-foreground">
                After the cluster comes back up, click Check now on this page to verify.
              </p>
            </li>
          </ol>
        </div>
      {:else if wizardProvider === "kubeadm"}
        <ol class="space-y-3 text-xs">
          <li>
            <p class="font-medium text-foreground">1. SSH to a control-plane node</p>
          </li>
          <li>
            <p class="font-medium text-foreground">2. Renew all control-plane certs</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo kubeadm certs renew all</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">3. Restart control-plane containers</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo systemctl restart kubelet</code
            >
            <p class="mt-1 text-muted-foreground">
              Static-pod kubelet will restart kube-apiserver, controller-manager, scheduler, etcd
              containers so they pick up the new certs.
            </p>
          </li>
          <li>
            <p class="font-medium text-foreground">4. Update kubeconfigs for cluster admins</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo cp /etc/kubernetes/admin.conf ~/.kube/config</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">5. Verify from this page</p>
            <p class="text-muted-foreground">Close this wizard and click Check now.</p>
          </li>
        </ol>
      {:else if wizardProvider === "k3s"}
        <ol class="space-y-3 text-xs">
          <li>
            <p class="font-medium text-foreground">1. On each server node (control plane)</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo systemctl restart k3s</code
            >
            <p class="mt-1 text-muted-foreground">
              k3s regenerates its CA/certs if they are within 90 days of expiry; otherwise rotation
              needs `k3s certificate rotate`.
            </p>
          </li>
          <li>
            <p class="font-medium text-foreground">2. Force rotation if needed</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo k3s certificate rotate --service=*</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">3. On each agent node</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo systemctl restart k3s-agent</code
            >
          </li>
        </ol>
      {:else if wizardProvider === "rke2"}
        <ol class="space-y-3 text-xs">
          <li>
            <p class="font-medium text-foreground">1. On each server node</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo rke2 certificate rotate</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">2. Restart RKE2</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo systemctl restart rke2-server</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">3. On each agent</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >sudo systemctl restart rke2-agent</code
            >
          </li>
        </ol>
      {:else if wizardProvider === "openshift"}
        <ol class="space-y-3 text-xs">
          <li>
            <p class="font-medium text-foreground">1. Inspect expiring certs</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono">oc get csr -o wide</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">2. Approve pending CSRs</p>
            <code class="mt-1 block rounded bg-muted px-2 py-1.5 font-mono"
              >oc adm certificate approve &lt;csr-name&gt;</code
            >
          </li>
          <li>
            <p class="font-medium text-foreground">3. Force rotation via the operator</p>
            <p class="text-muted-foreground">
              The cluster-kube-apiserver-operator automatically rotates certs every year; you can
              force-refresh the kubeconfig with <code class="font-mono"
                >oc get secret -n openshift-kube-apiserver localhost-serving-cert-certkey -o yaml</code
              >.
            </p>
          </li>
        </ol>
      {:else}
        <p class="text-xs text-muted-foreground">
          Wizard steps are not yet specialized for this distribution. Fall back to the generic
          command:
        </p>
        <code class="mt-2 block rounded bg-muted px-2 py-1.5 font-mono text-xs"
          >{strategy.command}</code
        >
      {/if}
    </div>
    <div class="flex items-center justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" size="sm" onclick={() => (wizardOpen = false)}>Close</Button>
    </div>
  </div>
{/if}
