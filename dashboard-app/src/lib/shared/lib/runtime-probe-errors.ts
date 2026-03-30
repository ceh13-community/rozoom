const OPTIONAL_CAPABILITY_ERROR_PATTERNS = [
  'the server doesn\'t have a resource type "gatewayclasses"',
  'the server doesn\'t have a resource type "gateways"',
  'the server doesn\'t have a resource type "httproutes"',
  'the server doesn\'t have a resource type "referencegrants"',
  'the server doesn\'t have a resource type "volumeattributesclasses"',
  'the server doesn\'t have a resource type "volumesnapshots"',
  'the server doesn\'t have a resource type "volumesnapshotcontents"',
  'the server doesn\'t have a resource type "volumesnapshotclasses"',
  'the server doesn\'t have a resource type "verticalpodautoscalers"',
];

const DEGRADED_METRICS_ERROR_PATTERNS = [
  "metrics api not available",
  "/apis/metrics.k8s.io/v1beta1/nodes",
  "/apis/metrics.k8s.io/v1beta1/pods",
  "nodes.metrics.k8s.io notfound",
  "pods.metrics.k8s.io notfound",
  'no endpoints available for service "http:kube-prometheus-stack-kubelet:10250"',
  "service is defined without a selector",
  "error trying to reach service: eof",
];

function normalizeMessage(message: string) {
  return message.trim().toLowerCase();
}

export function isOptionalCapabilityError(message: string) {
  const normalized = normalizeMessage(message);
  return OPTIONAL_CAPABILITY_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isDegradedMetricsProbeError(message: string) {
  const normalized = normalizeMessage(message);
  if (
    normalized.includes("the server could not find the requested resource") &&
    (normalized.includes("/apis/metrics.k8s.io/") || normalized.includes(".metrics.k8s.io"))
  ) {
    return true;
  }
  return DEGRADED_METRICS_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isExpectedClusterProbeError(message: string) {
  return isOptionalCapabilityError(message) || isDegradedMetricsProbeError(message);
}

export function isCommandUnavailableProbeError(message: string) {
  const normalized = normalizeMessage(message);
  return (
    normalized.includes("command terminated with exit code 127") ||
    normalized.includes("exit code 127")
  );
}
