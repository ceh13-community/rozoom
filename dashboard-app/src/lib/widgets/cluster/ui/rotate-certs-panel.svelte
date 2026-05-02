<script lang="ts">
  import { onMount } from "svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";

  const autoRun = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));
  import { checkCertificatesHealth, updateClusterCheckPartially } from "$features/check-health";
  import type {
    CertificatesReport,
  } from "$features/check-health/model/types";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
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

  type CsrItem = { name: string; status: string; requestor: string; age: string };

  let report = $state<CertificatesReport | null>(null);
  let loading = $state(false);
  let rotating = $state(false);
  let approvingCsrs = $state(false);
  let rotateResult = $state<{ ok: boolean; message: string } | null>(null);
  let distributionHint = $state<string | null>(null);
  let pendingCsrs = $state<CsrItem[]>([]);
  let allCsrs = $state<CsrItem[]>([]);

  const certificates = $derived(report?.certificates ?? []);
  const kubeletRotation = $derived(report?.kubeletRotation ?? []);
  const summary = $derived(report?.summary ?? null);
  const hasExpired = $derived(certificates.some((c) => c.status === "critical"));
  const allOk = $derived(
    certificates.length > 0 && certificates.every((c) => c.status === "ok"),
  );
  const updatedAtText = $derived(
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  function statusBadge(status: string): string {
    if (status === "ok" || status === "enabled" || status === "Approved") return "bg-green-600 text-white";
    if (status === "warning" || status === "Pending") return "bg-yellow-500 text-black";
    if (status === "critical" || status === "disabled" || status === "Denied") return "bg-red-600 text-white";
    return "bg-gray-500 text-white";
  }

  function formatDays(days?: number): string {
    if (days === undefined || !Number.isFinite(days)) return "-";
    const d = Math.floor(days);
    if (d < 0) return `expired ${Math.abs(d)}d ago`;
    return `${d}d`;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    rotateResult = null;
    try {
      await detectDistribution();
      await fetchCsrs();
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
        kubectlRawFront(
          "get nodes -o jsonpath='{.items[*].metadata.name}'",
          { clusterId, source: "rotate-certs:detect-distro" },
        ),
        kubectlRawFront(
          "version -o json",
          { clusterId, source: "rotate-certs:detect-version" },
        ),
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
          const ocRes = await kubectlRawFront(
            "api-versions",
            { clusterId, source: "rotate-certs:detect-openshift" },
          );
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
            else if (pid.includes("hetzner") || pid.includes("hcloud")) distributionHint = "hetzner";
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
      const res = await kubectlRawFront(
        "get csr -o json",
        { clusterId, source: "rotate-certs:list-csrs" },
      );
      if (res.code !== 0) {
        allCsrs = [];
        pendingCsrs = [];
        return;
      }
      const parsed = JSON.parse(res.output || "{}");
      const items = (parsed.items ?? []) as Array<{
        metadata?: { name?: string; creationTimestamp?: string };
        spec?: { username?: string };
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
        };
      });

      pendingCsrs = allCsrs.filter((c) => c.status === "Pending");
    } catch {
      allCsrs = [];
      pendingCsrs = [];
    }
  }

  const MANAGED_PROVIDERS = new Set(["eks", "gke", "aks", "doks", "hetzner", "oke"]);
  const LOCAL_RUNTIMES = new Set(["minikube", "kind", "k3d", "docker-desktop", "rancher-desktop", "colima"]);

  const isManaged = $derived(MANAGED_PROVIDERS.has(distributionHint ?? ""));
  const isLocal = $derived(LOCAL_RUNTIMES.has(distributionHint ?? ""));

  type RotateStrategy = {
    label: string;
    command: string;
    canAutoRotate: boolean;
  };

  const STRATEGY: Record<string, RotateStrategy> = {
    kubeadm:           { label: "kubeadm",          command: "kubeadm certs renew all && systemctl restart kubelet", canAutoRotate: true },
    k3s:               { label: "K3s",              command: "systemctl restart k3s (master) / k3s-agent (workers)", canAutoRotate: false },
    rke2:              { label: "RKE2",             command: "systemctl restart rke2-server / rke2-agent",           canAutoRotate: false },
    openshift:         { label: "OpenShift",        command: "oc adm certificate approve <csr>",                    canAutoRotate: true },
    minikube:          { label: "Minikube",         command: "minikube stop && minikube start",                      canAutoRotate: false },
    kind:              { label: "Kind",             command: "kind delete cluster && kind create cluster",           canAutoRotate: false },
    k3d:               { label: "K3d",              command: "k3d cluster stop <name> && k3d cluster start <name>",  canAutoRotate: false },
    "docker-desktop":  { label: "Docker Desktop",   command: "Reset Kubernetes cluster in Docker Desktop settings",  canAutoRotate: false },
    "rancher-desktop": { label: "Rancher Desktop",  command: "Reset Kubernetes in Rancher Desktop preferences",      canAutoRotate: false },
    colima:            { label: "Colima",           command: "colima stop && colima start --kubernetes",              canAutoRotate: false },
    eks:               { label: "AWS EKS",          command: "Managed by AWS - certificates rotate automatically",   canAutoRotate: false },
    gke:               { label: "GKE",              command: "Managed by Google - certificates rotate automatically", canAutoRotate: false },
    aks:               { label: "AKS",              command: "Managed by Azure - certificates rotate automatically",  canAutoRotate: false },
    doks:              { label: "DigitalOcean",     command: "Managed by DigitalOcean - certificates rotate automatically", canAutoRotate: false },
    hetzner:           { label: "Hetzner",          command: "Managed by Hetzner - certificates rotate automatically", canAutoRotate: false },
    oke:               { label: "Oracle OKE",       command: "Managed by Oracle - certificates rotate automatically",  canAutoRotate: false },
  };

  const strategy = $derived(STRATEGY[distributionHint ?? ""] ?? STRATEGY.kubeadm);
  const rotateHint = $derived(strategy.command);

  async function approveAllPendingCsrs() {
    if (approvingCsrs || pendingCsrs.length === 0) return;
    approvingCsrs = true;
    rotateResult = null;

    const approved: string[] = [];
    const failed: string[] = [];

    for (const csr of pendingCsrs) {
      try {
        const res = await kubectlRawFront(
          `certificate approve ${csr.name}`,
          { clusterId, source: "rotate-certs:approve-csr" },
        );
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
      rotateResult = { ok: true, message: `Approved ${approved.length} CSR(s). Certificates should renew shortly.` };
    } else if (approved.length > 0) {
      rotateResult = { ok: true, message: `Approved ${approved.length} CSR(s). ${failed.length} failed:\n${failed.join("\n")}` };
    } else {
      rotateResult = { ok: false, message: `All CSR approvals failed:\n${failed.join("\n")}` };
    }

    approvingCsrs = false;
    await fetchCsrs();
  }

  async function rotateCertificates() {
    if (rotating || isManaged) return;
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
            message: "Certificates renewed via kubeadm.\nRestart kubelet on each node: systemctl restart kubelet",
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
        message: error instanceof Error ? error.message : "Unexpected error during certificate rotation.",
      };
    } finally {
      rotating = false;
    }
  }

  onMount(() => {
    if (autoRun) {
      void refresh();
    }
  });
</script>

<div class="space-y-4 p-1">
  <DiagnosticSummaryCard title="Certificate Rotation">
    <div class="flex items-center justify-between gap-2">
      <div>
        <p class="text-xs text-muted-foreground">
          {summary?.message ?? "Run a scan to check certificate status."}
        </p>
        {#if summary?.warnings?.length}
          {#each summary.warnings as w}
            <p class="text-xs text-yellow-500 mt-1">{w}</p>
          {/each}
        {/if}
        <p class="text-[10px] text-muted-foreground mt-1">Last checked: {updatedAtText}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onclick={refresh}
        loading={loading}
        loadingLabel="Scanning"
      >
        Check now
      </Button>
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
            <span class="text-muted-foreground">Certificates are managed by the cloud provider.</span>
          {:else if isLocal}
            <span class="text-muted-foreground">Local cluster - restart to regenerate certificates:</span>
          {:else}
            <span class="text-muted-foreground">Rotation command:</span>
          {/if}
        </div>
        {#if !isManaged}
          <code class="mt-2 block text-xs bg-muted px-2 py-1.5 rounded font-mono">{rotateHint}</code>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  {#if rotateResult}
    <Alert.Root variant={rotateResult.ok ? "default" : "destructive"}>
      <Alert.Title>{rotateResult.ok ? "Success" : "Rotation Failed"}</Alert.Title>
      <Alert.Description class="text-xs whitespace-pre-wrap">{rotateResult.message}</Alert.Description>
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
                  <Table.Cell class="font-mono text-xs max-w-[200px] truncate">{csr.name}</Table.Cell>
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
      <div class="flex items-center justify-between">
        <Card.Title class="text-sm font-medium">Control-Plane Certificates</Card.Title>
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
    </Card.Header>
    <Card.Content>
      {#if loading && certificates.length === 0}
        <div class="text-center py-6 text-muted-foreground text-sm"><LoadingDots /> Scanning certificates...</div>
      {:else if certificates.length === 0}
        <TableEmptyState message="No control-plane certificate data available. This is normal for minikube, kind, and managed clusters." />
      {:else}
        <TableSurface>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Certificate</Table.Head>
                <Table.Head>Expires</Table.Head>
                <Table.Head class="text-right">Days Left</Table.Head>
                <Table.Head class="text-right">Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each certificates as cert (cert.name)}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{cert.name}</Table.Cell>
                  <Table.Cell class="text-xs text-muted-foreground">{cert.expiresAt ?? "-"}</Table.Cell>
                  <Table.Cell class="text-right text-xs font-medium">{formatDays(cert.daysLeft)}</Table.Cell>
                  <Table.Cell class="text-right">
                    <Badge class={`text-[10px] ${statusBadge(cert.status)}`}>
                      {cert.status.toUpperCase()}
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
        <div class="text-center py-6 text-muted-foreground text-sm"><LoadingDots /> Checking nodes...</div>
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
</div>
