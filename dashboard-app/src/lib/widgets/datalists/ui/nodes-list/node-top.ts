import { kubectlRawFront } from "$shared/api/kubectl-proxy";

export type NodeTopMetrics = {
  cpu: string;
  cpuPercent: string;
  memory: string;
  memoryPercent: string;
};

export function parseNodeTopOutput(output: string): NodeTopMetrics {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const metricsLine = lines.find((line, index) => index > 0 && !/^name\s+/i.test(line));
  if (!metricsLine) {
    throw new Error("No metrics line");
  }

  const parts = metricsLine.split(/\s+/);
  if (parts.length < 5) {
    throw new Error("Unexpected top node output");
  }

  return {
    cpu: parts[1] ?? "-",
    cpuPercent: parts[2] ?? "-",
    memory: parts[3] ?? "-",
    memoryPercent: parts[4] ?? "-",
  };
}

export async function loadNodeTop(clusterId: string, nodeName: string, signal?: AbortSignal) {
  const response = await kubectlRawFront(`top node ${nodeName}`, { clusterId, signal });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || `Failed to load top node for ${nodeName}.`);
  }
  return parseNodeTopOutput(response.output || "");
}
