/**
 * Web Worker for offloading heavy cache serialization from the main thread.
 * Used to sanitize and prepare large health check data before persisting to Tauri cache.
 */

type SanitizeRequest = {
  type: "sanitize";
  id: number;
  data: unknown;
};

type SanitizeResponse = {
  type: "sanitize_result";
  id: number;
  result: unknown;
  error?: string;
};

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

self.onmessage = (event: MessageEvent<SanitizeRequest>) => {
  const { id, data } = event.data;

  try {
    const result = sanitizeCacheValue(data);
    const response: SanitizeResponse = { type: "sanitize_result", id, result };
    self.postMessage(response);
  } catch (err) {
    const response: SanitizeResponse = {
      type: "sanitize_result",
      id,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
