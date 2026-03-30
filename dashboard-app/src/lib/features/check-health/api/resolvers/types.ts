export type MetricsSource = "metrics-server" | "kubelet" | "node-exporter" | "prometheus" | "none";

export type ResolverResult<T> =
  | { ok: true; source: MetricsSource; data: T }
  | { ok: false; source: MetricsSource; error: string };

export interface ResolverContext {
  clusterId: string;
}

export interface CpuMemRow {
  name: string;
  cpuUsage: string; // "12%"
  memoryUsage: string; // "55%"
}

export interface DiskRow {
  name: string;
  freeDisk: string; // "24.61 GiB" or "~13%" etc
}

export interface CpuMemResolver {
  resolve(ctx: ResolverContext): Promise<ResolverResult<CpuMemRow[]>>;
}

export interface DiskResolver {
  resolve(ctx: ResolverContext, nodes: string[]): Promise<ResolverResult<Record<string, string>>>;
}
