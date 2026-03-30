export type NodeCapacityEntry = {
  name: string;
  allocatableCpuMillicores: number;
  allocatableMemoryMiB: number;
  reservedCpuMillicores: number;
  reservedMemoryMiB: number;
  usedCpuMillicores: number;
  usedMemoryMiB: number;
  headroomCpuMillicores: number;
  headroomMemoryMiB: number;
  cpuUtilizationPercent: number;
  memoryUtilizationPercent: number;
};

export type NodeCapacityReport = {
  nodes: NodeCapacityEntry[];
  totals: {
    allocatableCpu: number;
    allocatableMemory: number;
    reservedCpu: number;
    reservedMemory: number;
    usedCpu: number;
    usedMemory: number;
    headroomCpu: number;
    headroomMemory: number;
    avgCpuUtilization: number;
    avgMemoryUtilization: number;
  };
};

type NodeInput = {
  name: string;
  allocatableCpuMillicores: number;
  allocatableMemoryMiB: number;
  requestedCpuMillicores: number;
  requestedMemoryMiB: number;
  usedCpuMillicores: number;
  usedMemoryMiB: number;
};

export function buildNodeCapacityReport(nodes: NodeInput[]): NodeCapacityReport {
  const entries: NodeCapacityEntry[] = nodes.map((n) => {
    const headroomCpu = Math.max(0, n.allocatableCpuMillicores - n.requestedCpuMillicores);
    const headroomMem = Math.max(0, n.allocatableMemoryMiB - n.requestedMemoryMiB);
    const cpuUtil =
      n.allocatableCpuMillicores > 0
        ? Math.round((n.usedCpuMillicores / n.allocatableCpuMillicores) * 100)
        : 0;
    const memUtil =
      n.allocatableMemoryMiB > 0 ? Math.round((n.usedMemoryMiB / n.allocatableMemoryMiB) * 100) : 0;

    return {
      name: n.name,
      allocatableCpuMillicores: n.allocatableCpuMillicores,
      allocatableMemoryMiB: n.allocatableMemoryMiB,
      reservedCpuMillicores: n.requestedCpuMillicores,
      reservedMemoryMiB: n.requestedMemoryMiB,
      usedCpuMillicores: n.usedCpuMillicores,
      usedMemoryMiB: n.usedMemoryMiB,
      headroomCpuMillicores: headroomCpu,
      headroomMemoryMiB: headroomMem,
      cpuUtilizationPercent: cpuUtil,
      memoryUtilizationPercent: memUtil,
    };
  });

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  const allocCpu = sum(entries.map((e) => e.allocatableCpuMillicores));
  const allocMem = sum(entries.map((e) => e.allocatableMemoryMiB));
  const resCpu = sum(entries.map((e) => e.reservedCpuMillicores));
  const resMem = sum(entries.map((e) => e.reservedMemoryMiB));
  const usedCpu = sum(entries.map((e) => e.usedCpuMillicores));
  const usedMem = sum(entries.map((e) => e.usedMemoryMiB));

  return {
    nodes: entries,
    totals: {
      allocatableCpu: allocCpu,
      allocatableMemory: allocMem,
      reservedCpu: resCpu,
      reservedMemory: resMem,
      usedCpu: usedCpu,
      usedMemory: usedMem,
      headroomCpu: Math.max(0, allocCpu - resCpu),
      headroomMemory: Math.max(0, allocMem - resMem),
      avgCpuUtilization: allocCpu > 0 ? Math.round((usedCpu / allocCpu) * 100) : 0,
      avgMemoryUtilization: allocMem > 0 ? Math.round((usedMem / allocMem) * 100) : 0,
    },
  };
}
