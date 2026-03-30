export interface MetricResult<T> {
  success: boolean;
  value?: T;
  source?: string;
  error?: string;
}

export interface NodeCpuMem {
  cpuPercent: number;
  memoryPercent: number;
}

export interface NodeDisk {
  availableBytes: number;
  availableGiB: number;
}

export interface NodeMetricsResolver<T> {
  name: string;
  isAvailable(clusterId: string): Promise<boolean>;
  resolve(clusterId: string, nodeName: string): Promise<MetricResult<T>>;
}
