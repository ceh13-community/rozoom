import { describe, expect, it } from "vitest";
import {
  isCommandUnavailableProbeError,
  isDegradedMetricsProbeError,
  isExpectedClusterProbeError,
  isOptionalCapabilityError,
} from "./runtime-probe-errors";

describe("runtime-probe-errors", () => {
  it("recognizes optional capability gaps", () => {
    expect(
      isOptionalCapabilityError('error: the server doesn\'t have a resource type "gatewayclasses"'),
    ).toBe(true);
    expect(
      isExpectedClusterProbeError(
        'error: the server doesn\'t have a resource type "verticalpodautoscalers"',
      ),
    ).toBe(true);
    expect(
      isOptionalCapabilityError(
        'error: the server doesn\'t have a resource type "volumesnapshotclasses"',
      ),
    ).toBe(true);
  });

  it("recognizes degraded metrics probe failures", () => {
    expect(
      isDegradedMetricsProbeError(
        'Error from server (ServiceUnavailable): no endpoints available for service "http:kube-prometheus-stack-kubelet:10250"',
      ),
    ).toBe(true);
    expect(
      isExpectedClusterProbeError(
        "Error from server (ServiceUnavailable): error trying to reach service: EOF",
      ),
    ).toBe(true);
    expect(
      isDegradedMetricsProbeError(
        "cannot attach to *v1.Service: invalid service 'kube-prometheus-stack-kubelet': Service is defined without a selector",
      ),
    ).toBe(true);
    expect(
      isDegradedMetricsProbeError(
        'kubectl command failed: cluster=dev code=1 args="get --raw /apis/metrics.k8s.io/v1beta1/nodes --request-timeout=10s" stderr="Error from server (NotFound): the server could not find the requested resource"',
      ),
    ).toBe(true);
  });

  it("recognizes unavailable command probes", () => {
    expect(isCommandUnavailableProbeError("command terminated with exit code 127")).toBe(true);
    expect(
      isCommandUnavailableProbeError(
        "[ERROR] [2026-03-09T21:37:21.136Z]: command terminated with exit code 127",
      ),
    ).toBe(true);
  });
});
