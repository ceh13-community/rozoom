export interface HumanizedCertError {
  title: string;
  hint: string | null;
}

/** Map a raw kubectl / kubeadm stderr line to a titled error + fix hint. */
export function humanizeCertError(raw: string): HumanizedCertError {
  const lower = raw.toLowerCase();

  if (lower.includes("already approved")) {
    return {
      title: "CSR already approved",
      hint: "Another operator may have approved this CSR concurrently. Refresh to sync.",
    };
  }
  if (lower.includes("denied") || lower.includes("rejected")) {
    return {
      title: "CSR was denied",
      hint: "The CSR was denied (manually or by a controller). Delete it so the kubelet can create a new one.",
    };
  }
  if (
    (lower.includes("forbidden") || lower.includes("unauthorized")) &&
    lower.includes("certificatesigningrequest")
  ) {
    return {
      title: "RBAC forbids CSR approval",
      hint: "Your user lacks the approve verb on certificatesigningrequests/<signer>. Use cluster-admin or an ApprovalRequest role.",
    };
  }
  if (lower.includes("forbidden") || lower.includes("unauthorized")) {
    return {
      title: "Permission denied",
      hint: "Kubeconfig user lacks RBAC for this operation. Switch context or re-authenticate.",
    };
  }
  if (lower.includes("not found") && lower.includes("csr")) {
    return {
      title: "CSR not found",
      hint: "Cert list is stale - click Check now to refresh.",
    };
  }
  if (lower.includes("kubeadm") && (lower.includes("exit status") || lower.includes("failed"))) {
    return {
      title: "kubeadm renewal failed inside the apiserver pod",
      hint: "This can happen on managed control planes or when kubeadm is not present. Use the provider-specific wizard below.",
    };
  }
  if (lower.includes("exec") && lower.includes("not found")) {
    return {
      title: "kubectl exec not supported on the apiserver pod",
      hint: "Your cluster does not allow exec into the API server. Use the provider-specific wizard below.",
    };
  }
  if (lower.includes("x509") || lower.includes("certificate")) {
    return {
      title: "TLS error talking to the API server",
      hint: "Your kubeconfig certificate may be expired. Try refreshing credentials via Cluster Manager.",
    };
  }
  if (
    lower.includes("connection refused") ||
    lower.includes("no route to host") ||
    lower.includes("econnrefused")
  ) {
    return {
      title: "API server unreachable",
      hint: "kubectl could not reach the API server. Check cluster availability and kubeconfig.",
    };
  }
  return { title: "Certificate action failed", hint: null };
}
