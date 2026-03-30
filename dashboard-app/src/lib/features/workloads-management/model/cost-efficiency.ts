export type CostEfficiencyEntry = {
  namespace: string;
  cpuCostMonthly: number;
  memoryCostMonthly: number;
  totalCostMonthly: number;
  cpuEfficiency: number;
  memoryEfficiency: number;
  wastedCpuCostMonthly: number;
  wastedMemoryCostMonthly: number;
  wastedTotalMonthly: number;
};

export type CostEfficiencyReport = {
  entries: CostEfficiencyEntry[];
  totals: {
    totalMonthly: number;
    wastedMonthly: number;
    efficiencyPercent: number;
    savingsOpportunity: number;
  };
};

export type CostPricing = {
  cpuPerCoreMonth: number;
  memoryPerGiBMonth: number;
};

export const DEFAULT_PRICING: CostPricing = {
  cpuPerCoreMonth: 30,
  memoryPerGiBMonth: 4,
};

type NamespaceResourceUsage = {
  namespace: string;
  cpuRequestMillicores: number;
  cpuUsageMillicores: number;
  memoryRequestMiB: number;
  memoryUsageMiB: number;
};

export function calculateCostEfficiency(
  namespaces: NamespaceResourceUsage[],
  pricing: CostPricing = DEFAULT_PRICING,
): CostEfficiencyReport {
  const entries: CostEfficiencyEntry[] = namespaces.map((ns) => {
    const cpuReqCores = ns.cpuRequestMillicores / 1000;
    const cpuUseCores = ns.cpuUsageMillicores / 1000;
    const memReqGiB = ns.memoryRequestMiB / 1024;
    const memUseGiB = ns.memoryUsageMiB / 1024;

    const cpuCost = cpuReqCores * pricing.cpuPerCoreMonth;
    const memCost = memReqGiB * pricing.memoryPerGiBMonth;
    const totalCost = cpuCost + memCost;

    const cpuEff = cpuReqCores > 0 ? Math.round((cpuUseCores / cpuReqCores) * 100) : 0;
    const memEff = memReqGiB > 0 ? Math.round((memUseGiB / memReqGiB) * 100) : 0;

    const wastedCpuCores = Math.max(0, cpuReqCores - cpuUseCores);
    const wastedMemGiB = Math.max(0, memReqGiB - memUseGiB);
    const wastedCpuCost = wastedCpuCores * pricing.cpuPerCoreMonth;
    const wastedMemCost = wastedMemGiB * pricing.memoryPerGiBMonth;

    return {
      namespace: ns.namespace,
      cpuCostMonthly: Math.round(cpuCost * 100) / 100,
      memoryCostMonthly: Math.round(memCost * 100) / 100,
      totalCostMonthly: Math.round(totalCost * 100) / 100,
      cpuEfficiency: cpuEff,
      memoryEfficiency: memEff,
      wastedCpuCostMonthly: Math.round(wastedCpuCost * 100) / 100,
      wastedMemoryCostMonthly: Math.round(wastedMemCost * 100) / 100,
      wastedTotalMonthly: Math.round((wastedCpuCost + wastedMemCost) * 100) / 100,
    };
  });

  entries.sort((a, b) => b.wastedTotalMonthly - a.wastedTotalMonthly);

  const totalMonthly = entries.reduce((s, e) => s + e.totalCostMonthly, 0);
  const wastedMonthly = entries.reduce((s, e) => s + e.wastedTotalMonthly, 0);
  const effPercent =
    totalMonthly > 0 ? Math.round(((totalMonthly - wastedMonthly) / totalMonthly) * 100) : 0;

  return {
    entries,
    totals: {
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      wastedMonthly: Math.round(wastedMonthly * 100) / 100,
      efficiencyPercent: effPercent,
      savingsOpportunity: Math.round(wastedMonthly * 100) / 100,
    },
  };
}
