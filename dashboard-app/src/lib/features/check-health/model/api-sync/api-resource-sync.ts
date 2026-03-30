import { eventBus } from "../stream-watchers/event-bus";
import { derived, get, writable, type Readable } from "svelte/store";
import { listKubeResource, watchKubeResource } from "$shared/api/kube-api-client";
import { activeApiSyncClusterIds } from "./api-sync-activity";
import {
  markApiPathCapability,
  markApiPathCapabilityFromError,
  shouldSkipApiPath,
} from "./api-capability-cache";
import {
  trackWatcherEvent,
  trackWatcherFallback,
  trackWatcherListSuccess,
  trackWatcherPathSkipped,
  trackWatcherRelist,
  trackWatcherRetry,
  trackWatcherSessionStart,
  trackWatcherSessionStop,
  trackWatcherTransportError,
} from "../watcher-telemetry";

export type ApiResourceRuntimeState = {
  refCount: number;
  isRunning: boolean;
  transport: "api" | "fallback" | "idle";
  resourceVersion: string;
  lastListAt: number | null;
  lastEventAt: number | null;
  error: string | null;
  relistCount: number;
  retryCount: number;
};

type ActiveSession = {
  controller: AbortController | null;
  fallbackActive: boolean;
  refCount: number;
  resourceVersion: string;
  retryCount: number;
};

const DEFAULT_RUNTIME_STATE: ApiResourceRuntimeState = {
  refCount: 0,
  isRunning: false,
  transport: "idle",
  resourceVersion: "",
  lastListAt: null,
  lastEventAt: null,
  error: null,
  relistCount: 0,
  retryCount: 0,
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function computeRetryDelay(retryCount: number) {
  const baseDelay = Math.min(30_000, 1_000 * 2 ** Math.max(0, retryCount - 1));
  return baseDelay + Math.floor(Math.random() * 500);
}

const MAX_API_RETRIES_BEFORE_FALLBACK = 2;

type ApiResourceSyncController<Item> = {
  start(clusterId: string): void;
  stop(clusterId: string): void;
  selectRuntimeState(clusterId: string): Readable<ApiResourceRuntimeState>;
  destroy(): void;
  readonly __itemType?: Item;
};

export function createApiResourceSync<Item>(options: {
  getPath?: () => string;
  getPaths?: () => string[];
  kind: string;
  setInitial: (clusterId: string, items: Item[]) => void;
  fallbackStart?: (clusterId: string) => void;
  fallbackStop?: (clusterId: string) => void;
}): ApiResourceSyncController<Item> {
  const active = new Map<string, ActiveSession>();
  const runtimeStates = writable<Record<string, ApiResourceRuntimeState>>({});

  function isClusterActive(clusterId: string) {
    return get(activeApiSyncClusterIds).includes(clusterId);
  }

  function updateRuntimeState(
    clusterId: string,
    updater: (prev: ApiResourceRuntimeState) => ApiResourceRuntimeState,
  ) {
    runtimeStates.update((current) => ({
      ...current,
      [clusterId]: updater(current[clusterId] ?? DEFAULT_RUNTIME_STATE),
    }));
  }

  function getPathCandidates() {
    if (options.getPaths) {
      return options.getPaths();
    }
    if (options.getPath) {
      return [options.getPath()];
    }
    return [];
  }

  async function listWithResolvedPath(clusterId: string, signal: AbortSignal) {
    const configuredCandidates = getPathCandidates();
    const preferredCandidates = configuredCandidates.filter(
      (path) => !shouldSkipApiPath(clusterId, path),
    );
    const skippedCandidates = configuredCandidates.filter((path) =>
      shouldSkipApiPath(clusterId, path),
    );
    const candidates = [...preferredCandidates, ...skippedCandidates];
    let lastError: unknown = new Error(`No API paths configured for ${options.kind}`);

    for (const path of skippedCandidates) {
      trackWatcherPathSkipped({
        clusterId,
        kind: options.kind,
        path,
      });
    }

    for (const path of candidates) {
      try {
        const result = await listKubeResource<Item>({
          clusterId,
          path,
          signal,
        });
        markApiPathCapability(clusterId, path, { status: "available" });
        trackWatcherListSuccess({
          clusterId,
          kind: options.kind,
          path,
          items: result.items.length,
          resourceVersion: result.resourceVersion,
        });
        return { path, ...result };
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        markApiPathCapabilityFromError(clusterId, path, error);
        trackWatcherTransportError({
          clusterId,
          kind: options.kind,
          path,
          stage: "list",
          error: error instanceof Error ? error.message : String(error),
        });
        lastError = error;
      }
    }

    throw lastError;
  }

  function stopSession(clusterId: string, session: ActiveSession) {
    session.controller?.abort();
    const stoppedTransport = session.fallbackActive ? "fallback" : "api";
    session.controller = null;
    if (session.fallbackActive) {
      options.fallbackStop?.(clusterId);
      session.fallbackActive = false;
    }
    updateRuntimeState(clusterId, (prev) => ({
      ...prev,
      isRunning: false,
      transport: "idle",
    }));
    trackWatcherSessionStop({
      clusterId,
      kind: options.kind,
      transport: stoppedTransport,
      refCount: session.refCount,
    });
  }

  async function runSession(clusterId: string, session: ActiveSession) {
    const controller = session.controller;
    if (!controller) return;

    const enableFallback = () => {
      if (session.fallbackActive) return;
      session.fallbackActive = true;
      options.fallbackStart?.(clusterId);
      updateRuntimeState(clusterId, (prev) => ({
        ...prev,
        isRunning: true,
        transport: "fallback",
      }));
    };

    try {
      const initial = await listWithResolvedPath(clusterId, controller.signal);
      options.setInitial(clusterId, initial.items);
      session.resourceVersion = initial.resourceVersion;
      updateRuntimeState(clusterId, (prev) => ({
        ...prev,
        isRunning: true,
        transport: "api",
        resourceVersion: initial.resourceVersion,
        lastListAt: Date.now(),
        error: null,
        retryCount: session.retryCount,
      }));

      while (!controller.signal.aborted) {
        const result = await watchKubeResource<Item>({
          clusterId,
          path: initial.path,
          resourceVersion: session.resourceVersion,
          signal: controller.signal,
          sendInitialEvents: session.resourceVersion.length === 0,
          onEvent: (event) => {
            const nextResourceVersion =
              (event.object as { metadata?: { resourceVersion?: string } } | undefined)?.metadata
                ?.resourceVersion ?? session.resourceVersion;
            session.resourceVersion = nextResourceVersion;
            trackWatcherEvent({
              clusterId,
              kind: options.kind,
              path: initial.path,
              eventType: event.type,
              resourceVersion: nextResourceVersion,
            });
            updateRuntimeState(clusterId, (prev) => ({
              ...prev,
              transport: "api",
              resourceVersion: nextResourceVersion,
              lastEventAt: Date.now(),
              error: event.type === "ERROR" ? "Watch event error" : null,
              retryCount: session.retryCount,
            }));
            if (event.type === "BOOKMARK" || event.type === "ERROR") return;
            eventBus.emit({
              clusterId,
              kind: options.kind,
              payload: event,
            });
          },
        });

        if (result.expired) {
          trackWatcherRelist({
            clusterId,
            kind: options.kind,
            path: initial.path,
            resourceVersion: session.resourceVersion,
          });
          const relist = await listKubeResource<Item>({
            clusterId,
            path: initial.path,
            signal: controller.signal,
          });
          options.setInitial(clusterId, relist.items);
          session.resourceVersion = relist.resourceVersion;
          updateRuntimeState(clusterId, (prev) => ({
            ...prev,
            isRunning: true,
            transport: "api",
            resourceVersion: relist.resourceVersion,
            lastListAt: Date.now(),
            error: null,
            relistCount: prev.relistCount + 1,
            retryCount: session.retryCount,
          }));
          continue;
        }

        session.resourceVersion = result.resourceVersion;
        session.retryCount = 0;
        updateRuntimeState(clusterId, (prev) => ({
          ...prev,
          isRunning: true,
          transport: "api",
          resourceVersion: result.resourceVersion,
          error: null,
          retryCount: 0,
        }));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        trackWatcherTransportError({
          clusterId,
          kind: options.kind,
          stage: "watch",
          error: error instanceof Error ? error.message : String(error),
          retryCount: session.retryCount + 1,
        });
        session.retryCount += 1;
        updateRuntimeState(clusterId, (prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "API sync failed",
          retryCount: session.retryCount,
        }));
        if (session.retryCount >= MAX_API_RETRIES_BEFORE_FALLBACK) {
          enableFallback();
          trackWatcherFallback({
            clusterId,
            kind: options.kind,
            reason: "max_api_retries_exceeded",
            retryCount: session.retryCount,
          });
          return;
        }
        const retryDelayMs = computeRetryDelay(session.retryCount);
        trackWatcherRetry({
          clusterId,
          kind: options.kind,
          retryCount: session.retryCount,
          backoffMs: retryDelayMs,
        });
        try {
          await sleep(retryDelayMs, controller.signal);
        } catch {
          return;
        }
        if (isClusterActive(clusterId)) {
          session.controller = new AbortController();
          void runSession(clusterId, session);
          return;
        }
        enableFallback();
      }
    } finally {
      if (session.controller === controller) {
        session.controller = null;
      }
      if (controller.signal.aborted && !session.fallbackActive) {
        updateRuntimeState(clusterId, (prev) => ({
          ...prev,
          isRunning: false,
          transport: "idle",
        }));
      }
    }
  }

  function ensureSessionRunning(clusterId: string, session: ActiveSession) {
    if (session.refCount <= 0) return;
    if (!isClusterActive(clusterId)) {
      stopSession(clusterId, session);
      return;
    }
    if (session.controller) return;
    session.controller = new AbortController();
    session.fallbackActive = false;
    trackWatcherSessionStart({
      clusterId,
      kind: options.kind,
      refCount: session.refCount,
    });
    updateRuntimeState(clusterId, (prev) => ({
      ...prev,
      isRunning: true,
      transport: "idle",
      error: null,
    }));
    void runSession(clusterId, session);
  }

  const unsubscribeActivity = activeApiSyncClusterIds.subscribe(() => {
    for (const [clusterId, session] of active.entries()) {
      if (isClusterActive(clusterId)) {
        ensureSessionRunning(clusterId, session);
      } else {
        stopSession(clusterId, session);
      }
    }
  });

  return {
    start(clusterId: string) {
      const existing = active.get(clusterId);
      if (existing) {
        existing.refCount += 1;
        updateRuntimeState(clusterId, (prev) => ({
          ...prev,
          refCount: existing.refCount,
          isRunning: isClusterActive(clusterId),
        }));
        ensureSessionRunning(clusterId, existing);
        return;
      }
      const session: ActiveSession = {
        controller: null,
        fallbackActive: false,
        refCount: 1,
        resourceVersion: "",
        retryCount: 0,
      };
      active.set(clusterId, session);
      updateRuntimeState(clusterId, () => ({
        ...DEFAULT_RUNTIME_STATE,
        refCount: 1,
        isRunning: isClusterActive(clusterId),
      }));
      ensureSessionRunning(clusterId, session);
    },
    stop(clusterId: string) {
      const session = active.get(clusterId);
      if (!session) return;
      session.refCount -= 1;
      if (session.refCount > 0) {
        updateRuntimeState(clusterId, (prev) => ({
          ...prev,
          refCount: session.refCount,
        }));
        return;
      }
      stopSession(clusterId, session);
      active.delete(clusterId);
      updateRuntimeState(clusterId, (prev) => ({
        ...prev,
        refCount: 0,
        isRunning: false,
        transport: "idle",
      }));
    },
    selectRuntimeState(clusterId: string): Readable<ApiResourceRuntimeState> {
      return derived(runtimeStates, ($states) => $states[clusterId] ?? DEFAULT_RUNTIME_STATE);
    },
    destroy() {
      unsubscribeActivity();
      for (const [clusterId, session] of active.entries()) {
        stopSession(clusterId, session);
      }
      active.clear();
    },
  };
}
