export type BinPackingNodeScore = {
  name: string;
  cpuPackingPercent: number;
  memoryPackingPercent: number;
  score: number;
  grade: "tight" | "balanced" | "sparse" | "empty";
};

export type BinPackingReport = {
  nodes: BinPackingNodeScore[];
  clusterScore: number;
  clusterGrade: "tight" | "balanced" | "sparse" | "empty";
  fragmentationPercent: number;
};

type NodeInput = {
  name: string;
  allocatableCpuMillicores: number;
  allocatableMemoryMiB: number;
  requestedCpuMillicores: number;
  requestedMemoryMiB: number;
};

function gradeScore(score: number): BinPackingNodeScore["grade"] {
  if (score >= 80) return "tight";
  if (score >= 50) return "balanced";
  if (score > 0) return "sparse";
  return "empty";
}

export function calculateBinPacking(nodes: NodeInput[]): BinPackingReport {
  if (nodes.length === 0) {
    return { nodes: [], clusterScore: 0, clusterGrade: "empty", fragmentationPercent: 0 };
  }

  const scored: BinPackingNodeScore[] = nodes.map((n) => {
    const cpuPack =
      n.allocatableCpuMillicores > 0
        ? Math.round((n.requestedCpuMillicores / n.allocatableCpuMillicores) * 100)
        : 0;
    const memPack =
      n.allocatableMemoryMiB > 0
        ? Math.round((n.requestedMemoryMiB / n.allocatableMemoryMiB) * 100)
        : 0;
    const score = Math.round((cpuPack + memPack) / 2);

    return {
      name: n.name,
      cpuPackingPercent: Math.min(cpuPack, 100),
      memoryPackingPercent: Math.min(memPack, 100),
      score: Math.min(score, 100),
      grade: gradeScore(score),
    };
  });

  const totalAllocCpu = nodes.reduce((s, n) => s + n.allocatableCpuMillicores, 0);
  const totalAllocMem = nodes.reduce((s, n) => s + n.allocatableMemoryMiB, 0);
  const totalReqCpu = nodes.reduce((s, n) => s + n.requestedCpuMillicores, 0);
  const totalReqMem = nodes.reduce((s, n) => s + n.requestedMemoryMiB, 0);

  const clusterCpuPack = totalAllocCpu > 0 ? (totalReqCpu / totalAllocCpu) * 100 : 0;
  const clusterMemPack = totalAllocMem > 0 ? (totalReqMem / totalAllocMem) * 100 : 0;
  const clusterScore = Math.round(Math.min((clusterCpuPack + clusterMemPack) / 2, 100));

  const sparseNodes = scored.filter((n) => n.grade === "sparse" || n.grade === "empty").length;
  const fragmentationPercent = Math.round((sparseNodes / scored.length) * 100);

  return {
    nodes: scored,
    clusterScore,
    clusterGrade: gradeScore(clusterScore),
    fragmentationPercent,
  };
}
