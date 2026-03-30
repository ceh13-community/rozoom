const lastRefreshAt = new Map<string, number>();

export function shouldRefreshOnSectionEnter(key: string, ttlMs: number): boolean {
  const last = lastRefreshAt.get(key);
  if (!last) return true;
  return Date.now() - last >= ttlMs;
}

export function markSectionRefreshed(key: string) {
  lastRefreshAt.set(key, Date.now());
}

export function resetSectionEnterRefresh() {
  lastRefreshAt.clear();
}
