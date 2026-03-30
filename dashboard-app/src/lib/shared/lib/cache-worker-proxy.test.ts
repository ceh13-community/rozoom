import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cache-worker-proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sanitizeInWorker", () => {
    it("returns data as-is when Worker constructor is unavailable (fallback)", async () => {
      const originalWorker = globalThis.Worker;
      // @ts-expect-error -- removing Worker to simulate unavailability
      delete globalThis.Worker;

      try {
        const { sanitizeInWorker } = await import("./cache-worker-proxy");
        const data = { foo: "bar", nested: [1, 2, 3] };
        const result = await sanitizeInWorker(data);
        expect(result).toBe(data);
      } finally {
        globalThis.Worker = originalWorker;
      }
    });
  });

  describe("terminateCacheWorker", () => {
    it("cleans up and rejects pending requests", async () => {
      const terminateFn = vi.fn();
      const mockWorker = {
        postMessage: vi.fn(),
        terminate: terminateFn,
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as (() => void) | null,
      };

      const OriginalWorker = globalThis.Worker;
      // Must use a real class/function so the `new` call works
      globalThis.Worker = function () {
        return mockWorker;
      } as unknown as typeof Worker;

      try {
        const { sanitizeInWorker, terminateCacheWorker } = await import("./cache-worker-proxy");

        // Start a request that will stay pending
        const pendingPromise = sanitizeInWorker({ some: "data" });

        // Terminate the worker, which should reject all pending requests
        terminateCacheWorker();

        expect(terminateFn).toHaveBeenCalledTimes(1);

        await expect(pendingPromise).rejects.toThrow("Worker terminated");
      } finally {
        globalThis.Worker = OriginalWorker;
      }
    });
  });
});
