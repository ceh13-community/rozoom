import { set, get, has, remove, clear } from "tauri-plugin-cache-api";

function sanitizeCacheValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value instanceof Set) {
    return Array.from(value).map((entry) => sanitizeCacheValue(entry, seen));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, entry]) => [String(key), sanitizeCacheValue(entry, seen)]),
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCacheValue(entry, seen));
  }

  if (value && typeof value === "object") {
    const cached = seen.get(value);
    if (cached) {
      return cached;
    }

    const next: Record<string, unknown> = {};
    seen.set(value, next);

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = sanitizeCacheValue(entry, seen);
    }

    return next;
  }

  return value;
}

export async function setCache(key: string, value: unknown): Promise<void> {
  await set(key, sanitizeCacheValue(value));
}

export async function setCacheWithTTL(key: string, value: unknown, ttl: number): Promise<void> {
  await set(key, sanitizeCacheValue(value), { ttl });
}

export async function getCache<T>(key: string): Promise<T | null> {
  return await get<T>(key);
}

export async function cacheHasKey(key: string): Promise<boolean> {
  return await has(key);
}

export async function removeCache(key: string) {
  await remove(key);
}

export async function clearCache() {
  await clear();
}
