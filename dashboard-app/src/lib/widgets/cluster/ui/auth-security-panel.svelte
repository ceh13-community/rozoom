<script lang="ts">
  import { detectAuthMethod, type AuthMethodInfo } from "$features/cluster-manager/model/auth-detection";
  import { analyzeCredentialSecurity, type CredentialSecurityReport } from "$features/cluster-manager/model/credential-security";
  import * as Card from "$shared/ui/card";

  interface Props {
    clusterId: string;
    clusterName: string;
    execCommand?: string | null;
    authProvider?: string | null;
    hasToken?: boolean;
    hasCertAuth?: boolean;
    insecureSkipTls?: boolean;
  }

  const { clusterId, clusterName, execCommand, authProvider, hasToken, hasCertAuth, insecureSkipTls = false }: Props = $props();

  const authInfo = $derived<AuthMethodInfo>(detectAuthMethod({
    execCommand,
    authProvider,
    hasToken,
    hasCertAuth,
  }));

  const credReport = $derived<CredentialSecurityReport>(analyzeCredentialSecurity({
    clusterName,
    hasEmbeddedToken: hasToken ?? false,
    hasEmbeddedCert: hasCertAuth ?? false,
    hasEmbeddedKey: hasCertAuth ?? false,
    usesExecPlugin: !!execCommand,
    usesAuthProvider: !!authProvider,
    insecureSkipTlsVerify: insecureSkipTls,
    storedPlaintext: true,
  }));

  const riskColor = $derived(
    credReport.overallRisk === "critical" ? "text-rose-400" :
    credReport.overallRisk === "high" ? "text-orange-400" :
    credReport.overallRisk === "medium" ? "text-amber-400" :
    credReport.overallRisk === "low" ? "text-slate-400" :
    "text-emerald-400"
  );

  const securityColor = $derived(
    authInfo.securityLevel === "high" ? "text-emerald-400" :
    authInfo.securityLevel === "medium" ? "text-amber-400" :
    authInfo.securityLevel === "low" ? "text-rose-400" :
    "text-slate-500"
  );
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <Card.Title class="text-sm">Authentication & Credential Security</Card.Title>
    <p class="text-[10px] text-slate-500 mt-0.5">Auth method detection (X.509/token/exec/OIDC), JWT token expiry tracking, credential storage risk analysis with score and remediation.</p>
  </Card.Header>
  <Card.Content class="space-y-3 text-xs">
    <!-- Auth Method -->
    <div class="rounded border border-slate-700 p-2">
      <div class="flex items-center justify-between">
        <h4 class="text-[11px] font-semibold text-slate-300">Auth Method</h4>
        <span class="text-[10px] {securityColor} font-semibold uppercase">{authInfo.securityLevel}</span>
      </div>
      <p class="text-slate-200 mt-1">{authInfo.label}</p>
      <p class="text-[10px] text-slate-500 mt-0.5">{authInfo.description}</p>

      {#if authInfo.tokenExpiry}
        <div class="mt-1 text-[10px] {authInfo.tokenExpired ? 'text-rose-400' : authInfo.tokenExpiresInHours != null && authInfo.tokenExpiresInHours < 24 ? 'text-amber-400' : 'text-slate-400'}">
          Token: {authInfo.tokenExpired ? "EXPIRED" : `expires in ${authInfo.tokenExpiresInHours}h`}
        </div>
      {/if}

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
        <span class="text-[10px] {riskColor} font-semibold uppercase">{credReport.overallRisk} risk</span>
      </div>
      <div class="flex items-center gap-2 mt-1">
        <span class="text-slate-500">Score:</span>
        <span class="font-mono text-lg {credReport.score >= 80 ? 'text-emerald-400' : credReport.score >= 50 ? 'text-amber-400' : 'text-rose-400'}">{credReport.score}/100</span>
      </div>

      {#if credReport.findings.length > 0}
        <div class="mt-1.5 space-y-1">
          {#each credReport.findings as finding}
            <div class="text-[10px] rounded border px-1.5 py-0.5 {
              finding.risk === 'critical' ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' :
              finding.risk === 'high' ? 'border-orange-500/30 bg-orange-500/5 text-orange-300' :
              finding.risk === 'medium' ? 'border-amber-500/30 bg-amber-500/5 text-amber-300' :
              finding.risk === 'none' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' :
              'border-slate-600 text-slate-400'
            }">
              <p class="font-medium">{finding.title}</p>
              <p class="text-[9px] opacity-70 mt-0.5">{finding.remediation}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
