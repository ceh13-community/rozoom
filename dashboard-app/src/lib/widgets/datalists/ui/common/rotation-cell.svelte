<script lang="ts">
  interface Props {
    value: string;
    scope: "client" | "server";
  }

  const { value, scope }: Props = $props();

  // Per-scope explanation for the "Unknown" state. Kubelet rotation
  // can't be observed directly on every distribution; this tooltip
  // lists the common reasons so operators don't have to guess.
  const explanation = $derived.by(() => {
    if (value !== "Unknown") return null;
    const commonTail =
      "Check the node kubelet config directly or trust the provider's rotation policy.";
    if (scope === "client") {
      return (
        "Client cert rotation not observable from the control plane.\n" +
        "Likely reasons:\n" +
        " · EKS uses aws-iam-authenticator / aws eks get-token (exec plugin) — no CSR produced.\n" +
        " · GKE uses gke-gcloud-auth-plugin — no CSR produced.\n" +
        " · AKS uses Azure AD integration — no CSR produced.\n" +
        " · Control plane blocks /proxy/configz and no recent kubelet CSR was approved.\n" +
        commonTail
      );
    }
    return (
      "Server cert rotation not observable from the control plane.\n" +
      "Likely reasons:\n" +
      " · Kubelet /proxy/configz is blocked or times out.\n" +
      " · Rancher/RKE2 rotates kubelet serving certs outside the Kubernetes CSR flow.\n" +
      " · No recent kubernetes.io/kubelet-serving CSR was approved.\n" +
      commonTail
    );
  });

  const tone = $derived.by(() => {
    switch (value) {
      case "Enabled":
        return "text-emerald-500";
      case "Disabled":
        return "text-amber-500";
      case "Unknown":
      default:
        return "text-slate-400";
    }
  });
</script>

{#if explanation}
  <span
    class="inline-flex items-center gap-1 cursor-help border-b border-dotted border-slate-400/50 {tone}"
    title={explanation}
  >
    {value}
    <span class="text-[9px] font-bold opacity-60" aria-hidden="true">?</span>
  </span>
{:else}
  <span class={tone}>{value}</span>
{/if}
