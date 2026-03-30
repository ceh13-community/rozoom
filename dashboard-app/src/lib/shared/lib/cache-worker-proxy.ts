/**
 * Main-thread proxy for the cache serialization worker.
 * Falls back to synchronous sanitization if Worker is unavailable.
 */

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./cache-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; result: unknown; error?: string }>) => {
      const { id, result, error } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    };
    worker.onerror = () => {
      // Worker failed to load - fall back to main thread
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function sanitizeInWorker<T>(data: unknown): Promise<T> {
  const w = getWorker();
  if (!w) {
    // Fallback: run synchronously on main thread
    return Promise.resolve(data as T);
  }

  const id = ++requestId;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    w.postMessage({ type: "sanitize", id, data });
  });
}

export function terminateCacheWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const pending of pendingRequests.values()) {
    pending.reject(new Error("Worker terminated"));
  }
  pendingRequests.clear();
}
