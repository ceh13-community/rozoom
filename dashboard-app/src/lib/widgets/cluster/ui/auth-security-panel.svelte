<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    detectAuthMethod,
    type AuthMethodInfo,
  } from "$features/cluster-manager/model/auth-detection";
  import {
    analyzeCredentialSecurity,
    type CredentialRiskFinding,
    type CredentialSecurityReport,
  } from "$features/cluster-manager/model/credential-security";
  import { parseKubeconfigText } from "$entities/config";
  import { load as parseYaml } from "js-yaml";
  import { safeReadTextFile } from "$shared/lib/tauri-runtime";
  import { appDataDir } from "@tauri-apps/api/path";
  import { CONFIG_DIR } from "$entities/config";
  import { clusterKey } from "$shared/lib/cluster-key";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Card from "$shared/ui/card";
  import { Button } from "$shared/ui/button";
  import * as Alert from "$shared/ui/alert";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  type AuthPolicy = "exec-plugin" | "oidc" | "x509-certificate" | "any";

  interface Props {
    clusterId: string;
    clusterName: string;
    /** Optional fleet-wide policy for preferred auth method. When set, panel
     * flags clusters whose detected method does not match. */
    fleetPolicy?: AuthPolicy;
  }

  const { clusterId, clusterName, fleetPolicy }: Props = $props();

  type ParsedAuth = {
    execCommand: string | null;
    execArgs: string[] | null;
    authProvider: string | null;
    hasToken: boolean;
    hasCertAuth: boolean;
    token: string | null;
    insecureSkipTls: boolean;
    storedPlaintext: boolean;
  };

  let parsed = $state<ParsedAuth | null>(null);
  let parseError = $state<string | null>(null);
  let loading = $state(true);
  let wizardFinding = $state<CredentialRiskFinding | null>(null);
  // Periodic tick so JWT countdown re-renders each second while mounted.
  let tickMs = $state(Date.now());
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      tickMs = Date.now();
    }, 1000);
  }

  function stopTick() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function handleVisibility() {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") stopTick();
    else startTick();
  }

  onMount(() => {
    void loadKubeconfig();
    startTick();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
  });

  onDestroy(() => {
    stopTick();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  });

  async function loadKubeconfig() {
    loading = true;
    parseError = null;
    try {
      const appDir = await appDataDir();
      const path = `${appDir}/${CONFIG_DIR}/${clusterKey(clusterId)}.yaml`;
      const text = await safeReadTextFile(path);
      if (!text) {
        parseError = "Kubeconfig file is empty or unreadable.";
        return;
      }
      const raw = text;
      const config = await parseKubeconfigText(text);
      const ctxName = config.contexts[0]?.name;
      const userName = ctxName
        ? config.contexts.find((c) => c.name === ctxName)?.context?.user
        : config.users[0]?.name;
      const clusterRef = ctxName
        ? config.contexts.find((c) => c.name === ctxName)?.context?.cluster
        : config.clusters[0]?.name;
      const user = userName ? config.users.find((u) => u.name === userName) : config.users[0];
      const cluster = clusterRef
        ? config.clusters.find((c) => c.name === clusterRef)
        : config.clusters[0];

      const tokenValue = extractTokenFromRaw(raw, userName ?? user?.name ?? null);
      const keyEmbedded = /client-key-data:/.test(raw);

      parsed = {
        execCommand: user?.execCommand ?? null,
        execArgs: user?.execArgs ?? null,
        authProvider: user?.authProvider ?? null,
        hasToken: Boolean(user?.hasToken),
        hasCertAuth: Boolean(user?.hasCertAuth),
        token: tokenValue,
        insecureSkipTls: Boolean(cluster?.insecureSkipTlsVerify),
        // `storedPlaintext` is true when anything sensitive is inlined in the
        // file (token / client-key-data). Exec plugin output is not stored.
        storedPlaintext: Boolean(user?.hasToken) || keyEmbedded || Boolean(user?.hasCertAuth),
      };
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Failed to parse kubeconfig";
    } finally {
      loading = false;
    }
  }

  // Extract the bearer token from the named user entry in a kubeconfig YAML.
  // Uses the same js-yaml parser as the rest of the app (already a dep), so we
  // cover block-scalar (`token: |`), flow style, quoted strings, and user
  // names that start with a hyphen - none of which the old hand-rolled
  // line-by-line regex handled correctly.
  function extractTokenFromRaw(raw: string, userName: string | null): string | null {
    if (!userName) return null;
    try {
      const doc = parseYaml(raw) as {
        users?: Array<{
          name?: unknown;
          user?: { token?: unknown } & Record<string, unknown>;
        }>;
      } | null;
      if (!doc || !Array.isArray(doc.users)) return null;
      const entry = doc.users.find((u) => u && u.name === userName) ?? doc.users[0];
      const token = entry?.user?.token;
      return typeof token === "string" && token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  const authInfo = $derived<AuthMethodInfo>(
    detectAuthMethod({
      execCommand: parsed?.execCommand ?? null,
      execArgs: parsed?.execArgs ?? null,
      authProvider: parsed?.authProvider ?? null,
      hasToken: parsed?.hasToken ?? false,
      hasCertAuth: parsed?.hasCertAuth ?? false,
      token: parsed?.token ?? null,
    }),
  );

  const credReport = $derived<CredentialSecurityReport>(
    analyzeCredentialSecurity({
      clusterName,
      hasEmbeddedToken: parsed?.hasToken ?? false,
      hasEmbeddedCert: parsed?.hasCertAuth ?? false,
      hasEmbeddedKey: parsed?.hasCertAuth ?? false,
      usesExecPlugin: Boolean(parsed?.execCommand),
      usesAuthProvider: Boolean(parsed?.authProvider),
      insecureSkipTlsVerify: parsed?.insecureSkipTls ?? false,
      storedPlaintext: parsed?.storedPlaintext ?? false,
    }),
  );

  const riskColor = $derived(
    credReport.overallRisk === "critical"
      ? "text-rose-400"
      : credReport.overallRisk === "high"
        ? "text-orange-400"
        : credReport.overallRisk === "medium"
          ? "text-amber-400"
          : credReport.overallRisk === "low"
            ? "text-slate-400"
            : "text-emerald-400",
  );

  const securityColor = $derived(
    authInfo.securityLevel === "high"
      ? "text-emerald-400"
      : authInfo.securityLevel === "medium"
        ? "text-amber-400"
        : authInfo.securityLevel === "low"
          ? "text-rose-400"
          : "text-slate-500",
  );

  const policyViolation = $derived.by<string | null>(() => {
    if (!fleetPolicy || fleetPolicy === "any") return null;
    if (fleetPolicy === "exec-plugin" && authInfo.method !== "exec-plugin") {
      return `Fleet policy requires exec-plugin auth; detected ${authInfo.label}.`;
    }
    if (fleetPolicy === "oidc" && authInfo.method !== "oidc" && authInfo.method !== "exec-plugin") {
      return `Fleet policy requires OIDC; detected ${authInfo.label}.`;
    }
    if (fleetPolicy === "x509-certificate" && authInfo.method !== "x509-certificate") {
      return `Fleet policy requires X.509 client certs; detected ${authInfo.label}.`;
    }
    return null;
  });

  const tokenBannerSeverity = $derived.by<"critical" | "warning" | null>(() => {
    // Re-evaluate against tickMs so countdown stays fresh.
    void tickMs;
    if (authInfo.tokenExpired) return "critical";
    const hours = authInfo.tokenExpiresInHours;
    if (hours !== null && hours !== undefined && hours < 24) return "warning";
    return null;
  });

  function formatCountdown(expiry: string | null | undefined): string {
    if (!expiry) return "-";
    const ts = Date.parse(expiry);
    if (Number.isNaN(ts)) return "-";
    const diffSec = Math.max(0, Math.floor((ts - tickMs) / 1000));
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    const seconds = diffSec % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  function goToClusterManager() {
    void goto("/cluster-manager");
  }

  async function copyToClipboard(text: string, label = "Command copied to clipboard") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  type RemediationCommand = { label: string; command: string };

  function remediationCommandsFor(finding: CredentialRiskFinding): RemediationCommand[] {
    const title = finding.title.toLowerCase();
    if (title.includes("tls verification")) {
      return [
        {
          label: "Edit insecure-skip-tls-verify in kubeconfig",
          command: `kubectl config set clusters.${clusterName.replace(/[^A-Za-z0-9._-]/g, "-")}.insecure-skip-tls-verify false`,
        },
      ];
    }
    if (title.includes("bearer token") || title.includes("static")) {
      return [
        {
          label: "AWS EKS exec plugin (update kubeconfig)",
          command: "aws eks update-kubeconfig --name <cluster-name>",
        },
        {
          label: "GKE exec plugin (update kubeconfig)",
          command: "gcloud container clusters get-credentials <cluster-name>",
        },
        {
          label: "Azure AKS exec plugin (update kubeconfig)",
          command: "az aks get-credentials --name <cluster-name> --resource-group <rg>",
        },
      ];
    }
    if (title.includes("private key") || title.includes("certificate")) {
      return [
        {
          label: "Re-issue client cert via kubeadm (if applicable)",
          command: "kubeadm certs renew admin.conf",
        },
      ];
    }
    if (title.includes("auth-provider")) {
      return [
        {
          label: "Migrate legacy GKE auth-provider to exec plugin",
          command:
            "gcloud components install gke-gcloud-auth-plugin && gcloud container clusters get-credentials <cluster-name>",
        },
      ];
    }
    return [];
  }
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <div class="flex items-start justify-between gap-2">
      <div>
        <Card.Title class="text-sm">Authentication & Credential Security</Card.Title>
        <p class="mt-0.5 text-[10px] text-slate-500">
          Detected from this cluster's kubeconfig. JWT expiry tracks in real time; findings come
          with copy-ready remediation commands.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onclick={goToClusterManager}
        title="Open Cluster Manager to re-import kubeconfig or rotate credentials"
      >
        Refresh credentials
      </Button>
    </div>
  </Card.Header>

  <Card.Content class="space-y-3 text-xs">
    {#if loading}
      <div class="flex items-center gap-2 text-slate-400">
        <LoadingDots /> Parsing kubeconfig…
      </div>
    {:else if parseError}
      <Alert.Root variant="destructive">
        <Alert.Title>Cannot read kubeconfig</Alert.Title>
        <Alert.Description>{parseError}</Alert.Description>
      </Alert.Root>
    {:else}
      <!-- Token expiry banner + live countdown -->
      {#if authInfo.tokenExpiry}
        <div
          class={`rounded border px-3 py-2 ${
            tokenBannerSeverity === "critical"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
              : tokenBannerSeverity === "warning"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
          }`}
        >
          <div class="flex items-center justify-between gap-2">
            <div class="text-[11px]">
              <span class="font-semibold">
                {authInfo.tokenExpired ? "Token expired" : "Token expires in"}:
              </span>
              <span class="font-mono">{formatCountdown(authInfo.tokenExpiry)}</span>
              <span class="ml-2 text-[10px] opacity-80">({authInfo.tokenExpiry})</span>
            </div>
            {#if tokenBannerSeverity}
              <Button
                variant="outline"
                size="sm"
                class="h-6 text-[10px]"
                onclick={goToClusterManager}
              >
                Refresh in Cluster Manager
              </Button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Policy compliance -->
      {#if policyViolation}
        <div
          class="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300"
        >
          <span class="font-semibold">Policy mismatch:</span>
          {policyViolation}
        </div>
      {:else if fleetPolicy && fleetPolicy !== "any"}
        <div
          class="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-[11px] text-emerald-300"
        >
          <span class="font-semibold">✓ Policy aligned:</span> fleet policy = {fleetPolicy}.
        </div>
      {/if}

      <!-- Auth Method -->
      <div class="rounded border border-slate-700 p-2">
        <div class="flex items-center justify-between">
          <h4 class="text-[11px] font-semibold text-slate-300">Auth Method</h4>
          <span class="text-[10px] {securityColor} font-semibold uppercase"
            >{authInfo.securityLevel}</span
          >
        </div>
        <p class="mt-1 text-slate-200">{authInfo.label}</p>
        <p class="mt-0.5 text-[10px] text-slate-500">{authInfo.description}</p>

        {#if authInfo.warnings.length > 0}
          <div class="mt-1 space-y-0.5">
            {#each authInfo.warnings as warning}
              <p class="text-[10px] text-amber-400">! {warning}</p>
            {/each}
          </div>
        {/if}

        {#if authInfo.recommendations.length > 0}
          <div class="mt-1 space-y-0.5">
            {#each authInfo.recommendations as rec}
              <p class="text-[10px] text-slate-500">{rec}</p>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Credential Storage -->
      <div class="rounded border border-slate-700 p-2">
        <div class="flex items-center justify-between">
          <h4 class="text-[11px] font-semibold text-slate-300">Credential Storage</h4>
          <span class="text-[10px] {riskColor} font-semibold uppercase">
            {credReport.overallRisk} risk
          </span>
        </div>
        <div class="mt-1 flex items-center gap-2">
          <span class="text-slate-500">Score:</span>
          <span
            class="font-mono text-lg {credReport.score >= 80
              ? 'text-emerald-400'
              : credReport.score >= 50
                ? 'text-amber-400'
                : 'text-rose-400'}"
          >
            {credReport.score}/100
          </span>
        </div>

        {#if credReport.findings.length > 0}
          <div class="mt-1.5 space-y-1">
            {#each credReport.findings as finding}
              {@const cmds = remediationCommandsFor(finding)}
              <div
                class="rounded border px-1.5 py-1 text-[10px] {finding.risk === 'critical'
                  ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
                  : finding.risk === 'high'
                    ? 'border-orange-500/30 bg-orange-500/5 text-orange-300'
                    : finding.risk === 'medium'
                      ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
                      : finding.risk === 'none'
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                        : 'border-slate-600 text-slate-400'}"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-medium">{finding.title}</p>
                    <p class="mt-0.5 text-[9px] opacity-70">{finding.remediation}</p>
                  </div>
                  {#if cmds.length > 0}
                    <div class="flex shrink-0 gap-1">
                      {#if cmds.length === 1}
                        <button
                          type="button"
                          class="shrink-0 rounded border border-current px-1.5 py-0.5 text-[9px] font-semibold opacity-80 hover:opacity-100"
                          onclick={() => void copyToClipboard(cmds[0]!.command)}
                          title={cmds[0]!.label}
                        >
                          Copy fix
                        </button>
                      {:else}
                        <button
                          type="button"
                          class="shrink-0 rounded border border-current px-1.5 py-0.5 text-[9px] font-semibold opacity-80 hover:opacity-100"
                          onclick={() => (wizardFinding = finding)}
                        >
                          Fix ({cmds.length})
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

{#if wizardFinding}
  {@const cmds = remediationCommandsFor(wizardFinding)}
  <button
    type="button"
    class="fixed inset-0 z-[150] bg-black/40"
    aria-label="Close fix wizard"
    onclick={() => (wizardFinding = null)}
  ></button>
  <div
    class="fixed inset-y-6 right-6 z-[160] flex w-[min(70vw,640px)] flex-col rounded-lg border bg-background shadow-2xl"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div>
        <div class="text-sm font-semibold">Fix: {wizardFinding.title}</div>
        <div class="text-[11px] text-muted-foreground">
          Pick the cloud/provider that matches your cluster and copy the command.
        </div>
      </div>
      <Button variant="ghost" size="sm" onclick={() => (wizardFinding = null)}>Close</Button>
    </div>
    <div class="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-xs">
      <p class="text-muted-foreground">{wizardFinding.remediation}</p>
      {#each cmds as c}
        <div class="rounded border border-border bg-muted/30 p-2">
          <div class="mb-1 flex items-center justify-between gap-2">
            <p class="text-[11px] font-medium text-foreground">{c.label}</p>
            <Button
              variant="outline"
              size="sm"
              class="h-6 text-[10px]"
              onclick={() => void copyToClipboard(c.command, `Copied "${c.label}"`)}
            >
              Copy
            </Button>
          </div>
          <code class="block rounded bg-slate-950/70 px-2 py-1 font-mono text-[11px] text-slate-200"
            >{c.command}</code
          >
        </div>
      {/each}
    </div>
    <div class="flex items-center justify-between border-t px-4 py-3">
      <Button variant="ghost" size="sm" onclick={goToClusterManager}>Open Cluster Manager</Button>
      <Button variant="outline" size="sm" onclick={() => (wizardFinding = null)}>Close</Button>
    </div>
  </div>
{/if}
