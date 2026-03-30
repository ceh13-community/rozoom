import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadClusterRefreshInterval, saveClusterRefreshInterval } from "./refresh-preferences";
import { storeManager } from "$shared/store";

const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
};

vi.mock("$shared/store", () => ({
  storeManager: {
    getStore: vi.fn(),
  },
}));

describe("refresh-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storeManager.getStore).mockResolvedValue(mockStore as any);
  });

  it("returns null when no stored preference exists", async () => {
    mockStore.get.mockResolvedValue(null);

    const result = await loadClusterRefreshInterval("cluster-1");

    expect(result).toBeNull();
  });

  it("returns stored preference when present", async () => {
    mockStore.get.mockResolvedValue({ "cluster-1": 10 });

    const result = await loadClusterRefreshInterval("cluster-1");

    expect(result).toBe(10);
  });

  it("ignores invalid stored values", async () => {
    mockStore.get.mockResolvedValue({ "cluster-1": "bad" });

    const result = await loadClusterRefreshInterval("cluster-1");

    expect(result).toBeNull();
  });

  it("stores new preference values", async () => {
    mockStore.get.mockResolvedValue({ "cluster-1": 5 });

    await saveClusterRefreshInterval("cluster-2", 15);

    expect(mockStore.set).toHaveBeenCalledWith("clusterRefreshIntervals", {
      "cluster-1": 5,
      "cluster-2": 15,
    });
    expect(mockStore.save).toHaveBeenCalled();
  });
});
