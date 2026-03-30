import type { NodeItem } from "$shared/model/clusters";
import { STATUS_CLASSES } from "../model/constants";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { getClusterNodesNames } from "$shared/api/tauri";
import type { Conditions, NodesChecksBadge } from "../model/metrics";

export function countPressuresByConditions(conditions: Conditions[]): number {
  return conditions.reduce((total, item) => {
    const pressures = item.count.pressures;
    return total + Object.values(pressures).reduce((sum, pressure) => sum + pressure, 0);
  }, 0);
}

export async function getDiskUsage(clusterId: string): Promise<number | null> {
  const nodes = await getClusterNodesNames(clusterId);
  let size: number = 0;
  let avail: number = 0;
  const promises = nodes.map(async (nodeName) => {
    const kubeletMetrics = await kubectlRawFront(
      `get --raw /api/v1/nodes/${nodeName}/proxy/metrics/cadvisor`,
      { clusterId },
    );

    if (kubeletMetrics.errors.length) {
      return null;
    }

    const text = kubeletMetrics.output;
    size = parseFloat(
      text.match(/node_filesystem_size_bytes{[^}]*mountpoint="\/"} (\d+)/)?.[1] ?? "0",
    );
    avail = parseFloat(
      text.match(/node_filesystem_avail_bytes{[^}]*mountpoint="\/"} (\d+)/)?.[1] ?? "0",
    );
  });
  await Promise.all(promises);

  return size > 0 ? (1 - avail / size) * 100 : null;
}

export function prepareNodesBadge(nodes: NodeItem[]): NodesChecksBadge {
  if (nodes.length === 0) {
    return {
      className: STATUS_CLASSES.unknown,
      status: "N/A",
      count: { ready: 0, total: 0 },
    };
  }

  const thresholds = {
    criticalRatio: 0.1,
  };

  let readyTotal = 0;
  let diskPressureTotal = 0;
  let memoryPressureTotal = 0;
  let pidPressureTotal = 0;
  let networkUnavailableTotal = 0;
  let nodesWithPressure = 0;

  const result = nodes.map((node) => {
    const readyType = node.status.conditions?.find((c) => c.type === "Ready");
    const diskPressureType = node.status.conditions?.find((c) => c.type === "DiskPressure");
    const memoryPressureType = node.status.conditions?.find((c) => c.type === "MemoryPressure");
    const pidPressureType = node.status.conditions?.find((c) => c.type === "PIDPressure");
    const networkUnavailableType = node.status.conditions?.find(
      (c) => c.type === "NetworkUnavailable",
    );

    const ready = readyType?.status === "True" ? 1 : 0;
    const diskPressure = diskPressureType?.status === "True" ? 1 : 0;
    const memoryPressure = memoryPressureType?.status === "True" ? 1 : 0;
    const pidPressure = pidPressureType?.status === "True" ? 1 : 0;
    const networkUnavailable = networkUnavailableType?.status === "True" ? 1 : 0;

    readyTotal += ready;
    diskPressureTotal += diskPressure;
    memoryPressureTotal += memoryPressure;
    pidPressureTotal += pidPressure;
    networkUnavailableTotal += networkUnavailable;

    if (diskPressure + memoryPressure + pidPressure + networkUnavailable > 0) {
      nodesWithPressure += 1;
    }

    return {
      count: {
        ready,
        pressures: {
          diskPressure,
          memoryPressure,
          pidPressure,
          networkUnavailable,
        },
      },
    };
  });

  const allPressures = countPressuresByConditions(result);
  const counted = {
    ready: readyTotal,
    total: nodes.length,
    pressures: {
      diskPressure: diskPressureTotal,
      memoryPressure: memoryPressureTotal,
      pidPressure: pidPressureTotal,
      networkUnavailable: networkUnavailableTotal,
    },
  };

  if (readyTotal === nodes.length && allPressures === 0) {
    return {
      className: STATUS_CLASSES.ok,
      status: "Ok",
      count: counted,
    };
  }

  const notReadyCount = nodes.length - readyTotal;
  const issueRatio = nodes.length > 0 ? (notReadyCount + nodesWithPressure) / nodes.length : 0;

  if (issueRatio >= thresholds.criticalRatio) {
    return {
      className: STATUS_CLASSES.error,
      status: "Critical",
      count: counted,
    };
  }

  if (notReadyCount > 0 || allPressures > 0) {
    return {
      className: STATUS_CLASSES.warning,
      status: "Warning",
      count: counted,
    };
  }

  return {
    className: STATUS_CLASSES.unknown,
    status: "Unknown",
    count: counted,
  };
}
