import { writable, get } from "svelte/store";

export type AutoRefreshRotationState = {
  windowStart: number;
  windowSize: number;
  totalClusters: number;
  rotationIntervalMs: number;
};

const DEFAULT_ROTATION_INTERVAL_MS = 90_000;

const rotationState = writable<AutoRefreshRotationState>({
  windowStart: 0,
  windowSize: 8,
  totalClusters: 0,
  rotationIntervalMs: DEFAULT_ROTATION_INTERVAL_MS,
});

let rotationTimer: ReturnType<typeof setInterval> | null = null;

function advanceWindow() {
  rotationState.update((state) => {
    if (state.totalClusters <= state.windowSize) {
      return { ...state, windowStart: 0 };
    }
    const nextStart = state.windowStart + state.windowSize;
    return {
      ...state,
      windowStart: nextStart >= state.totalClusters ? 0 : nextStart,
    };
  });
}

export function startAutoRefreshRotation(totalClusters: number, windowSize: number) {
  stopAutoRefreshRotation();

  rotationState.set({
    windowStart: 0,
    windowSize: Math.max(1, windowSize),
    totalClusters,
    rotationIntervalMs: DEFAULT_ROTATION_INTERVAL_MS,
  });

  if (totalClusters > windowSize) {
    rotationTimer = setInterval(advanceWindow, DEFAULT_ROTATION_INTERVAL_MS);
  }
}

export function stopAutoRefreshRotation() {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
}

export function isIndexInAutoRefreshWindow(index: number): boolean {
  const state = get(rotationState);
  if (state.totalClusters <= state.windowSize) return true;
  const end = state.windowStart + state.windowSize;
  if (end <= state.totalClusters) {
    return index >= state.windowStart && index < end;
  }
  return index >= state.windowStart || index < end - state.totalClusters;
}

export const autoRefreshRotation = {
  subscribe: rotationState.subscribe,
};
