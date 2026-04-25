import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_REFRESH_INTERVAL_MINUTES,
  REFRESH_INTERVAL_OPTIONS,
  isValidRefreshInterval,
  loadClusterRefreshInterval,
  saveClusterRefreshInterval,
} from "./refresh-preferences";
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

  describe("canonical interval options", () => {
    it("exposes the same list of minutes for compact and detailed cards", () => {
      const minutes = REFRESH_INTERVAL_OPTIONS.map((option) => option.minutes);
      expect(minutes).toEqual([1, 5, 10, 15, 30]);
    });

    it("keeps value/label/short in sync for each option", () => {
      for (const option of REFRESH_INTERVAL_OPTIONS) {
        expect(option.value).toBe(String(option.minutes));
        expect(option.label).toBe(`${option.minutes} min`);
        expect(option.short).toBe(`${option.minutes}m`);
      }
    });

    it("default interval is one of the canonical options", () => {
      const minutes = REFRESH_INTERVAL_OPTIONS.map((option) => option.minutes);
      expect(minutes).toContain(DEFAULT_REFRESH_INTERVAL_MINUTES);
    });

    it("isValidRefreshInterval accepts every canonical minute and rejects others", () => {
      for (const option of REFRESH_INTERVAL_OPTIONS) {
        expect(isValidRefreshInterval(option.minutes)).toBe(true);
      }
      expect(isValidRefreshInterval(0)).toBe(false);
      expect(isValidRefreshInterval(7)).toBe(false);
      expect(isValidRefreshInterval(60)).toBe(false);
      expect(isValidRefreshInterval(null)).toBe(false);
      expect(isValidRefreshInterval(undefined)).toBe(false);
      expect(isValidRefreshInterval(Number.NaN)).toBe(false);
    });
  });
});
