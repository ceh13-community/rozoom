import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { Nodes } from "$shared/model/clusters";

const BYTE_UNITS = {
  Ki: 1024, // Kibibyte
  Mi: 1024 ** 2, // Mebibyte
  Gi: 1024 ** 3, // Gibibyte
  Ti: 1024 ** 4, // Tebibyte
} as const;

type ByteUnit = keyof typeof BYTE_UNITS;

const BYTE_PATTERN = /^(?<value>\d+(?:\.\d+)?)(?<unit>Ki|Mi|Gi|Ti)?$/;

type KubeletSummary = {
  node?: {
    cpu?: { usageNanoCores?: number };
    memory?: { workingSetBytes?: number };
  };
};

function safeJsonParse(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function parseCpuCores(input: string | undefined): number {
  const stringToParse = (input ?? "").trim();

  if (!stringToParse) return 0;

  if (stringToParse.endsWith("m")) {
    const v = Number.parseFloat(stringToParse.slice(0, -1));
    return Number.isFinite(v) ? v / 1000 : 0;
  }

  const v = Number.parseFloat(stringToParse);

  return Number.isFinite(v) ? v : 0;
}

function parseFloatWithFallback(input: string): number {
  const value = parseFloat(input);
  return isFinite(value) ? value : 0;
}

export function parseBytes(input: string | undefined): number {
  const normalizedInput = (input ?? "").trim();

  if (!normalizedInput) {
    return 0;
  }

  const match = normalizedInput.match(BYTE_PATTERN);

  if (!match) {
    return parseFloatWithFallback(normalizedInput);
  }

  const value = parseFloat(match.groups?.value ?? "");
  const unit = match.groups?.unit as ByteUnit | undefined;

  if (!isFinite(value)) {
    return 0;
  }

  return unit ? value * BYTE_UNITS[unit] : value;
}

function cpuPct(usageNanoCores: number, allocCores: number): number {
  if (!allocCores) return 0;

  const usedCores = usageNanoCores / 1e9;

  return Math.max(0, Math.min(100, (usedCores / allocCores) * 100));
}

function memPct(workingSetBytes: number, allocBytes: number): number {
  if (!allocBytes) return 0;
  return Math.max(0, Math.min(100, (workingSetBytes / allocBytes) * 100));
}

export async function cpuMemFromKubeletSummary(
  clusterId: string,
): Promise<Array<{ name: string; cpuPct: number; memPct: number }>> {
  const nodesRes = await kubectlRawFront("get nodes -o json", { clusterId });

  if (nodesRes.errors.length) throw new Error(nodesRes.errors);

  const parsed = safeJsonParse(nodesRes.output) as Partial<Nodes>;
  const nodes = Array.isArray(parsed.items) ? parsed.items : [];

  const allocFor = (name: string): { cpu: number; mem: number } => {
    const n = nodes.find((x) => x.metadata.name === name);
    return {
      cpu: parseCpuCores(n?.status.allocatable?.cpu),
      mem: parseBytes(n?.status.allocatable?.memory),
    };
  };

  return Promise.all(
    nodes.map(async (n) => {
      const name = n.metadata.name;
      const alloc = allocFor(name);

      const sumRes = await kubectlRawFront(`get --raw /api/v1/nodes/${name}/proxy/stats/summary`, {
        clusterId,
      });

      if (sumRes.errors.length) throw new Error(sumRes.errors);

      const summary = safeJsonParse(sumRes.output) as KubeletSummary;
      const cpuNano = summary.node?.cpu?.usageNanoCores ?? 0;
      const memWork = summary.node?.memory?.workingSetBytes ?? 0;

      return {
        name,
        cpuPct: Math.round(cpuPct(cpuNano, alloc.cpu)),
        memPct: Math.round(memPct(memWork, alloc.mem)),
      };
    }),
  );
}
