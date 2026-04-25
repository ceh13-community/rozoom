export interface HumanizedMetricsError {
  title: string;
  hint: string | null;
  fixCommand?: string;
  category:
    | "tls"
    | "rbac"
    | "timeout"
    | "payload"
    | "network"
    | "coverage"
    | "not_found"
    | "unknown";
}

export function humanizeMetricsError(raw: string, sourceId: string): HumanizedMetricsError {
  const lower = raw.toLowerCase();

  if (
    lower.includes("x509") ||
    lower.includes("ip sans") ||
    (lower.includes("certificate") && lower.includes("valid"))
  ) {
    return {
      title: "TLS certificate does not cover the kubelet IP",
      hint: "metrics-server talks to the kubelet over TLS. On minikube/kind/k3s the kubelet cert rarely has IP SANs, so verification fails. Either regenerate kubelet certs with IP SANs, or disable verification for dev clusters.",
      fixCommand:
        sourceId === "metrics-server"
          ? "helm upgrade --install metrics-server metrics-server/metrics-server \\\n  --namespace kube-system \\\n  --set args='{--kubelet-insecure-tls}'"
          : undefined,
      category: "tls",
    };
  }

  if (lower.includes("tls") || lower.includes("handshake")) {
    return {
      title: "TLS handshake failed",
      hint: "The scraper cannot establish TLS with the endpoint. Check certificate trust, service port (9100 for node-exporter, 8080 for kube-state-metrics), and cert rotation state.",
      category: "tls",
    };
  }

  if (
    lower.includes("forbidden") ||
    lower.includes("unauthorized") ||
    lower.includes("rbac") ||
    lower.includes("cannot list") ||
    lower.includes("cannot get")
  ) {
    return {
      title: "RBAC denied access to this source",
      hint: "Your kubeconfig user lacks the permissions to query this metrics endpoint. Each source ships a ClusterRole/Binding - verify it exists and the operator's ServiceAccount is bound correctly.",
      fixCommand:
        sourceId === "metrics-server"
          ? "kubectl get clusterrolebinding system:metrics-server -o yaml"
          : sourceId === "kube-state-metrics"
            ? "kubectl get clusterrolebinding kube-state-metrics -o yaml"
            : undefined,
      category: "rbac",
    };
  }

  if (
    lower.includes("timeout") ||
    lower.includes("deadline exceeded") ||
    lower.includes("i/o timeout")
  ) {
    return {
      title: "Probe timed out",
      hint: "The endpoint did not respond in time. Check pod Ready state, resource limits (metrics-server OOMs on large clusters), and CNI latency. Consider increasing the probe timeout.",
      category: "timeout",
    };
  }

  if (
    lower.includes("prometheus text not detected") ||
    lower.includes("did not return prometheus")
  ) {
    return {
      title: "Endpoint does not return Prometheus-format metrics",
      hint: "Something answered on the port but not in the text/plain exposition format. Verify the service selector points to the real component pod (not a placeholder), and that Service port matches the container port.",
      category: "payload",
    };
  }

  if (
    lower.includes("connection refused") ||
    lower.includes("econnrefused") ||
    lower.includes("no route to host") ||
    lower.includes("dial tcp")
  ) {
    return {
      title: "Cannot reach the metrics endpoint",
      hint:
        sourceId === "node-exporter"
          ? "node-exporter runs as a DaemonSet on port 9100 with hostNetwork. Check that the pod is Running on every node and that NetworkPolicy allows scraping."
          : "The Service endpoint is unreachable. Check pod Ready state, Service selector, and NetworkPolicy rules.",
      category: "network",
    };
  }

  if (
    lower.includes("no node-exporter pod") ||
    lower.includes("reports ") ||
    lower.includes("coverage")
  ) {
    return {
      title: "node-exporter does not cover every node",
      hint: "DaemonSet is installed but not scheduling on all nodes. Check tolerations for control-plane / GPU / ARM taints; the chart defaults only tolerate common taints.",
      fixCommand:
        "kubectl get ds -n monitoring node-exporter -o jsonpath='{.spec.template.spec.tolerations}'",
      category: "coverage",
    };
  }

  if (lower.includes("404") || lower.includes("not found") || lower.includes("notfound")) {
    return {
      title: "Endpoint returns 404 / resource not found",
      hint: "The source is not installed, or is installed in a different namespace than expected. Click Install, or adjust the release namespace.",
      category: "not_found",
    };
  }

  return { title: "Metrics source check failed", hint: null, category: "unknown" };
}
