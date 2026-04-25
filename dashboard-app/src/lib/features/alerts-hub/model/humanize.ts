export interface HumanizedAlertError {
  title: string;
  hint: string | null;
  category: "reachability" | "rbac" | "tls" | "not_installed" | "timeout" | "unknown";
}

export function humanizeAlertError(raw: string): HumanizedAlertError {
  const lower = raw.toLowerCase();

  if (lower.includes("connection refused") || lower.includes("econnrefused")) {
    return {
      title: "Alertmanager/Prometheus service not reachable",
      hint: "The Alertmanager or Prometheus Service in the monitoring namespace is unreachable. Check that the pods are Running, the Service selector matches, or port-forward manually: kubectl port-forward -n monitoring svc/alertmanager 9093:9093",
      category: "reachability",
    };
  }

  if (
    lower.includes("no route to host") ||
    lower.includes("dial tcp") ||
    lower.includes("i/o timeout")
  ) {
    return {
      title: "Network path to monitoring stack is broken",
      hint: "kubectl cannot reach the Alertmanager/Prometheus API. Check NetworkPolicy in the monitoring namespace and cluster DNS.",
      category: "reachability",
    };
  }

  if (lower.includes("404") || (lower.includes("not found") && lower.includes("service"))) {
    return {
      title: "Alertmanager Service not found",
      hint: "The expected Service does not exist in the monitoring namespace. If Prometheus stack is in a different namespace, update chart values; otherwise install kube-prometheus-stack via the Install button.",
      category: "not_installed",
    };
  }

  if (
    lower.includes("forbidden") ||
    lower.includes("unauthorized") ||
    lower.includes("cannot create resource") ||
    lower.includes("system:unauthenticated")
  ) {
    return {
      title: "RBAC denied the alert action",
      hint: "Creating silences or reading PrometheusRule/Alertmanager CRDs requires RBAC. Grant your kubeconfig user get/list on monitoring.coreos.com/* and create on alertmanager silences endpoint.",
      category: "rbac",
    };
  }

  if (
    lower.includes("tls") ||
    lower.includes("x509") ||
    lower.includes("self-signed certificate") ||
    lower.includes("certificate signed by unknown authority")
  ) {
    return {
      title: "TLS handshake with Alertmanager failed",
      hint: "If Alertmanager uses a self-signed cert, either trust the cluster CA in the client, port-forward over plain HTTP, or disable TLS verification in the Helm values (dev clusters only).",
      category: "tls",
    };
  }

  if (
    lower.includes("no matches for kind") ||
    lower.includes("doesn't have a resource type") ||
    (lower.includes("prometheusrules") && lower.includes("not found"))
  ) {
    return {
      title: "Prometheus Operator CRDs are not installed",
      hint: "PrometheusRule / Alertmanager CRDs are needed to manage rules from this panel. Install kube-prometheus-stack (includes the operator + CRDs).",
      category: "not_installed",
    };
  }

  if (lower.includes("timeout") || lower.includes("deadline exceeded")) {
    return {
      title: "Alert API call timed out",
      hint: "Alertmanager may be under load or the kubectl port-forward is slow. Retry; if persistent, check Alertmanager pod resources and node network.",
      category: "timeout",
    };
  }

  return { title: "Alert action failed", hint: null, category: "unknown" };
}
