import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SvelteKit `$app/environment` `browser` flag so history helpers
// exercise the localStorage path.
vi.mock("$app/environment", () => ({
  browser: true,
}));

import {
  detectFlapping,
  loadLastSnapshot,
  pushHistory,
  saveSnapshot,
  snapshotKey,
  type PressureSnapshot,
} from "./history";

function mockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((i: number) => [...store.keys()][i] ?? null),
    _store: store,
  };
}

describe("nodes-pressures history", () => {
  beforeEach(() => {
    const ls = mockLocalStorage();
    vi.stubGlobal("localStorage", ls);
  });

  it("snapshotKey joins node and condition with /", () => {
    expect(snapshotKey("node-1", "MemoryPressure")).toBe("node-1/MemoryPressure");
  });

  it("save then load returns the same snapshot", () => {
    const snap: PressureSnapshot = {
      takenAt: "2026-04-18T00:00:00Z",
      states: { "node-1/MemoryPressure": "True" },
    };
    saveSnapshot("cluster-a", snap);
    expect(loadLastSnapshot("cluster-a")).toEqual(snap);
  });

  it("load returns null for empty cluster", () => {
    expect(loadLastSnapshot("cluster-x")).toBeNull();
  });

  it("load returns null when stored value is invalid JSON", () => {
    localStorage.setItem("dashboard:nodes-pressures:snapshot:v1:bad", "{not json");
    expect(loadLastSnapshot("bad")).toBeNull();
  });

  it("pushHistory keeps only last 5 snapshots", () => {
    for (let i = 0; i < 8; i++) {
      pushHistory("cluster-a", {
        takenAt: String(i),
        states: { "node-1/MemoryPressure": i % 2 === 0 ? "True" : "False" },
      });
    }
    const raw = localStorage.getItem("dashboard:nodes-pressures:history:v1:cluster-a");
    const parsed = JSON.parse(raw!) as PressureSnapshot[];
    expect(parsed).toHaveLength(5);
    // newest first
    expect(parsed[0].takenAt).toBe("7");
    expect(parsed[4].takenAt).toBe("3");
  });

  it("detectFlapping returns false with < 3 snapshots", () => {
    pushHistory("cluster-a", {
      takenAt: "1",
      states: { "node-1/MemoryPressure": "True" },
    });
    pushHistory("cluster-a", {
      takenAt: "2",
      states: { "node-1/MemoryPressure": "False" },
    });
    expect(detectFlapping("cluster-a", "node-1", "MemoryPressure")).toBe(false);
  });

  it("detectFlapping returns true when condition toggles twice across 5 snapshots", () => {
    const seq = ["True", "False", "True", "False", "True"];
    seq.forEach((state, i) => {
      pushHistory("cluster-a", {
        takenAt: String(i),
        states: { "node-1/MemoryPressure": state },
      });
    });
    expect(detectFlapping("cluster-a", "node-1", "MemoryPressure")).toBe(true);
  });

  it("detectFlapping returns false when state is stable across snapshots", () => {
    for (let i = 0; i < 5; i++) {
      pushHistory("cluster-a", {
        takenAt: String(i),
        states: { "node-1/MemoryPressure": "True" },
      });
    }
    expect(detectFlapping("cluster-a", "node-1", "MemoryPressure")).toBe(false);
  });

  it("detectFlapping is scoped per cluster", () => {
    const seq = ["True", "False", "True"];
    seq.forEach((state, i) => {
      pushHistory("cluster-a", {
        takenAt: String(i),
        states: { "node-1/MemoryPressure": state },
      });
    });
    // Other cluster has no history -> not flapping
    expect(detectFlapping("cluster-b", "node-1", "MemoryPressure")).toBe(false);
  });
});
