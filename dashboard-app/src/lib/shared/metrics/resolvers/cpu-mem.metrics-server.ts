import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { NodeMetricsResolver, NodeCpuMem } from "../resolver.interface";

export const MetricsServerResolver: NodeMetricsResolver<NodeCpuMem> = {
  name: "metrics-server",

  async isAvailable(clusterId) {
    try {
      await kubectlRawFront("top nodes", { clusterId });
      return true;
    } catch {
      return false;
    }
  },

  async resolve(clusterId, nodeName) {
    try {
      const { output } = await kubectlRawFront(`top node ${nodeName}`, { clusterId });
      const line = output.split("\n")[1];

      if (!line) throw new Error("No metrics line");

      const [, , cpu, , mem] = line.trim().split(/\s+/);

      return {
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: parseInt(cpu),
          memoryPercent: parseInt(mem),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};
