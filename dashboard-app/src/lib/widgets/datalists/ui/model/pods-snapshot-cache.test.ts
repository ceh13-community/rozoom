import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPodsSnapshotScopeKey,
  clearPodsSnapshotCacheForTests,
  loadPersistedPodsSnapshot,
  persistPodsSnapshot,
} from "./pods-snapshot-cache";

describe("pods snapshot cache", () => {
  beforeEach(() => {
    clearPodsSnapshotCacheForTests();
    vi.unstubAllGlobals();
  });

  it("builds deterministic scope key for namespace sets", () => {
    expect(buildPodsSnapshotScopeKey("dev", null)).toBe("dev::all");
    expect(buildPodsSnapshotScopeKey("dev", [])).toBe("dev::none");
    expect(buildPodsSnapshotScopeKey("dev", ["kube-system", "default"])).toBe(
      "dev::default,kube-system",
    );
  });

  it("persists and hydrates snapshot via localStorage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          return storage.size;
        },
        key(index: number) {
          return Array.from(storage.keys())[index] ?? null;
        },
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
        removeItem(key: string) {
          storage.delete(key);
        },
      },
    });

    const scopeKey = buildPodsSnapshotScopeKey("dev", null);
    persistPodsSnapshot(scopeKey, [
      {
        metadata: {
          uid: "pod-1",
          name: "demo",
          namespace: "default",
        },
      },
    ]);

    const hydrated = loadPersistedPodsSnapshot(scopeKey);
    expect(hydrated?.scopeKey).toBe(scopeKey);
    expect(hydrated?.pods).toHaveLength(1);
    expect(hydrated?.pods[0]?.metadata?.name).toBe("demo");
  });
});
