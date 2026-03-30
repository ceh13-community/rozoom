export type ResolverResult<T> =
  | { success: true; source: string; data: T }
  | { success: false; source: string; error: string };

export interface MetricsResolver<T> {
  id: string;
  title: string;
  isAvailable(clusterId: string): Promise<boolean>;
  resolve(clusterId: string): Promise<ResolverResult<T>>;
}

export async function resolveWithFallback<T>(
  clusterId: string,
  resolvers: MetricsResolver<T>[],
): Promise<ResolverResult<T>> {
  for (const r of resolvers) {
    try {
      const ok = await r.isAvailable(clusterId);
      if (!ok) continue;

      const result = await r.resolve(clusterId);
      if (result.success) return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { success: false, source: r.id, error: msg };
    }
  }

  return { success: false, source: "none", error: "No resolver available" };
}
