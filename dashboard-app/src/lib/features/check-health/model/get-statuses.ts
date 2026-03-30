/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import type { ClusterCheckError, ClusterHealthChecks, PodRestart } from "./types";

export const hasErrors = (checks: ClusterHealthChecks | ClusterCheckError | null): boolean =>
  !checks || "errors" in checks;

export const hasNoNodesData = (checks: ClusterHealthChecks | ClusterCheckError | null): boolean => {
  if (!checks || (checks && !("nodes" in checks))) {
    return true;
  }

  return !checks.nodes?.summary?.count;
};

export const getPressuresCount = (checks: ClusterHealthChecks): number => {
  return checks?.nodes?.summary.count?.pressures
    ? Object.values(checks.nodes.summary.count.pressures).reduce(
        (sum, pressure) => sum + pressure,
        0,
      )
    : 0;
};

export const isCritical = (checks: ClusterHealthChecks): boolean => {
  const pressuresCount = getPressuresCount(checks);
  return (
    checks?.nodes?.summary.status === "Critical" ||
    pressuresCount > 1 ||
    checks?.apiServerLatency?.status === "critical" ||
    checks?.certificatesHealth?.status === "critical" ||
    checks?.podIssues?.status === "critical" ||
    checks?.admissionWebhooks?.status === "critical" ||
    checks?.warningEvents?.status === "critical" ||
    checks?.blackboxProbes?.status === "critical" ||
    checks?.apfHealth?.status === "critical" ||
    checks?.etcdHealth?.status === "critical"
  );
};

export const hasWarnings = (checks: ClusterHealthChecks): boolean => {
  const pressuresCount = getPressuresCount(checks);
  return (
    (pressuresCount > 0 && pressuresCount < 2) ||
    countTotalPodRestarts(checks.podRestarts) > 0 ||
    checks?.nodes?.summary.status === "Warning" ||
    checks?.apiServerLatency?.status === "warning" ||
    checks?.certificatesHealth?.status === "warning" ||
    checks?.podIssues?.status === "warning" ||
    checks?.admissionWebhooks?.status === "warning" ||
    checks?.warningEvents?.status === "warning" ||
    checks?.blackboxProbes?.status === "warning" ||
    checks?.apfHealth?.status === "warning" ||
    checks?.etcdHealth?.status === "warning"
  );
};

export const countTotalPodRestarts = (podRestarts: PodRestart[] | null) => {
  if (!podRestarts || !Array.isArray(podRestarts)) {
    return 0;
  }

  return podRestarts.reduce((total, pod) => {
    const containers = pod?.containers;

    if (!containers || !Array.isArray(containers)) {
      return total;
    }

    const podRestarts = containers.reduce((podTotal, container) => {
      const restartCount = container?.restartCount;
      return podTotal + (typeof restartCount === "number" ? restartCount : 0);
    }, 0);

    return total + podRestarts;
  }, 0);
};
