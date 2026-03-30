import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  startAutoRefreshRotation,
  stopAutoRefreshRotation,
  isIndexInAutoRefreshWindow,
  autoRefreshRotation,
} from "./auto-refresh-rotation.svelte";

describe("auto-refresh-rotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopAutoRefreshRotation();
    vi.useRealTimers();
  });

  describe("startAutoRefreshRotation", () => {
    it("sets initial state correctly", () => {
      startAutoRefreshRotation(20, 5);

      const state = get(autoRefreshRotation);
      expect(state.windowStart).toBe(0);
      expect(state.windowSize).toBe(5);
      expect(state.totalClusters).toBe(20);
      expect(state.rotationIntervalMs).toBe(90_000);
    });

    it("clamps windowSize to at least 1", () => {
      startAutoRefreshRotation(10, 0);

      const state = get(autoRefreshRotation);
      expect(state.windowSize).toBe(1);
    });

    it("clamps negative windowSize to 1", () => {
      startAutoRefreshRotation(10, -5);

      const state = get(autoRefreshRotation);
      expect(state.windowSize).toBe(1);
    });

    it("resets windowStart to 0 when called again", () => {
      startAutoRefreshRotation(20, 5);
      vi.advanceTimersByTime(90_000);
      expect(get(autoRefreshRotation).windowStart).toBe(5);

      startAutoRefreshRotation(20, 5);
      expect(get(autoRefreshRotation).windowStart).toBe(0);
    });
  });

  describe("stopAutoRefreshRotation", () => {
    it("clears the rotation timer so window stops advancing", () => {
      startAutoRefreshRotation(20, 5);
      stopAutoRefreshRotation();

      vi.advanceTimersByTime(90_000 * 5);
      expect(get(autoRefreshRotation).windowStart).toBe(0);
    });

    it("is safe to call when no rotation is active", () => {
      expect(() => stopAutoRefreshRotation()).not.toThrow();
    });
  });

  describe("isIndexInAutoRefreshWindow", () => {
    it("returns true for indices inside the window", () => {
      startAutoRefreshRotation(20, 5);

      expect(isIndexInAutoRefreshWindow(0)).toBe(true);
      expect(isIndexInAutoRefreshWindow(1)).toBe(true);
      expect(isIndexInAutoRefreshWindow(4)).toBe(true);
    });

    it("returns false for indices outside the window", () => {
      startAutoRefreshRotation(20, 5);

      expect(isIndexInAutoRefreshWindow(5)).toBe(false);
      expect(isIndexInAutoRefreshWindow(10)).toBe(false);
      expect(isIndexInAutoRefreshWindow(19)).toBe(false);
    });

    it("works correctly after window advances", () => {
      startAutoRefreshRotation(20, 5);
      vi.advanceTimersByTime(90_000);

      expect(isIndexInAutoRefreshWindow(0)).toBe(false);
      expect(isIndexInAutoRefreshWindow(5)).toBe(true);
      expect(isIndexInAutoRefreshWindow(9)).toBe(true);
      expect(isIndexInAutoRefreshWindow(10)).toBe(false);
    });
  });

  describe("window wrap-around", () => {
    it("wraps window back to 0 when reaching end of cluster list", () => {
      startAutoRefreshRotation(12, 5);

      // window: 0-4
      vi.advanceTimersByTime(90_000);
      // window: 5-9
      expect(get(autoRefreshRotation).windowStart).toBe(5);

      vi.advanceTimersByTime(90_000);
      // window: 10-14 would exceed total (12), so wraps to 0
      expect(get(autoRefreshRotation).windowStart).toBe(10);

      vi.advanceTimersByTime(90_000);
      // 10 + 5 = 15 >= 12, wraps to 0
      expect(get(autoRefreshRotation).windowStart).toBe(0);
    });

    it("handles wrap-around correctly for isIndexInAutoRefreshWindow", () => {
      startAutoRefreshRotation(12, 5);

      // Advance to windowStart=10, windowSize=5 → wraps around
      vi.advanceTimersByTime(90_000 * 2);
      expect(get(autoRefreshRotation).windowStart).toBe(10);

      // Indices 10, 11 are in range (end of list)
      expect(isIndexInAutoRefreshWindow(10)).toBe(true);
      expect(isIndexInAutoRefreshWindow(11)).toBe(true);
      // Indices 0, 1, 2 are in range (wrapped portion: end=15, 15-12=3)
      expect(isIndexInAutoRefreshWindow(0)).toBe(true);
      expect(isIndexInAutoRefreshWindow(1)).toBe(true);
      expect(isIndexInAutoRefreshWindow(2)).toBe(true);
      // Index 3 is outside
      expect(isIndexInAutoRefreshWindow(3)).toBe(false);
      expect(isIndexInAutoRefreshWindow(9)).toBe(false);
    });
  });

  describe("edge: totalClusters <= windowSize", () => {
    it("all indices are active when totalClusters equals windowSize", () => {
      startAutoRefreshRotation(5, 5);

      for (let i = 0; i < 5; i++) {
        expect(isIndexInAutoRefreshWindow(i)).toBe(true);
      }
    });

    it("all indices are active when totalClusters is less than windowSize", () => {
      startAutoRefreshRotation(3, 8);

      for (let i = 0; i < 3; i++) {
        expect(isIndexInAutoRefreshWindow(i)).toBe(true);
      }
    });

    it("does not start a timer when all clusters fit in the window", () => {
      startAutoRefreshRotation(5, 5);

      vi.advanceTimersByTime(90_000 * 10);
      expect(get(autoRefreshRotation).windowStart).toBe(0);
    });

    it("advanceWindow keeps windowStart at 0 when totalClusters <= windowSize", () => {
      startAutoRefreshRotation(3, 8);

      vi.advanceTimersByTime(90_000 * 5);
      expect(get(autoRefreshRotation).windowStart).toBe(0);
    });
  });

  describe("edge: single cluster", () => {
    it("single cluster is always in the window", () => {
      startAutoRefreshRotation(1, 8);

      expect(isIndexInAutoRefreshWindow(0)).toBe(true);
    });

    it("does not rotate with a single cluster", () => {
      startAutoRefreshRotation(1, 1);

      vi.advanceTimersByTime(90_000 * 10);
      expect(get(autoRefreshRotation).windowStart).toBe(0);
      expect(isIndexInAutoRefreshWindow(0)).toBe(true);
    });
  });

  describe("timer advances window after interval", () => {
    it("advances window exactly on each interval tick", () => {
      startAutoRefreshRotation(24, 8);

      expect(get(autoRefreshRotation).windowStart).toBe(0);

      vi.advanceTimersByTime(90_000);
      expect(get(autoRefreshRotation).windowStart).toBe(8);

      vi.advanceTimersByTime(90_000);
      expect(get(autoRefreshRotation).windowStart).toBe(16);

      vi.advanceTimersByTime(90_000);
      expect(get(autoRefreshRotation).windowStart).toBe(0);
    });

    it("does not advance before the interval elapses", () => {
      startAutoRefreshRotation(20, 5);

      vi.advanceTimersByTime(89_999);
      expect(get(autoRefreshRotation).windowStart).toBe(0);

      vi.advanceTimersByTime(1);
      expect(get(autoRefreshRotation).windowStart).toBe(5);
    });
  });

  describe("autoRefreshRotation store updates reactively", () => {
    it("notifies subscribers when rotation starts", () => {
      const values: number[] = [];
      const unsub = autoRefreshRotation.subscribe((state) => {
        values.push(state.windowStart);
      });

      startAutoRefreshRotation(20, 5);

      // Initial subscription value + set from startAutoRefreshRotation
      expect(values.length).toBeGreaterThanOrEqual(1);
      expect(values[values.length - 1]).toBe(0);

      unsub();
    });

    it("notifies subscribers when window advances", () => {
      const windowStarts: number[] = [];
      startAutoRefreshRotation(20, 5);

      const unsub = autoRefreshRotation.subscribe((state) => {
        windowStarts.push(state.windowStart);
      });

      vi.advanceTimersByTime(90_000);
      vi.advanceTimersByTime(90_000);

      expect(windowStarts).toContain(0);
      expect(windowStarts).toContain(5);
      expect(windowStarts).toContain(10);

      unsub();
    });
  });
});
