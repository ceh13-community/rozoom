import { eventBus } from "../stream-watchers/event-bus";
import type { WatchLifecycleHooks } from "../stream-watchers/watcher-model";
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
  /** The kubectl watch fallback has delivered a full list since it (re)started. */
  fallbackSynced: boolean;
};

type ActiveSession = {
  controller: AbortController | null;
  fallbackActive: boolean;
  /** The fallback watcher gave up restarting; its stream is dead. */
  fallbackDead: boolean;
  /** Bumped on every fallback start/stop so late hooks of an old watcher are ignored. */
  fallbackGeneration: number;
  fallbackRetryTimer: ReturnType<typeof setTimeout> | null;
  fallbackRetryAttempt: number;
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
  fallbackSynced: false,
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
// While on the kubectl watch fallback, the API path is tried again on a timer:
// 60 s, then doubling up to 5 min. A working API watch replaces the fallback.
const FALLBACK_API_RETRY_BASE_MS = 60_000;
const FALLBACK_API_RETRY_MAX_MS = 300_000;

/**
 * A stream is live while its session runs on a working transport: an API watch
 * after a successful list, or the kubectl watch fallback after it delivered a
 * full list and while it has not given up. A live stream with no events means
 * nothing changed, so its data is fresh. Lists read this instead of the time of
 * the last data change.
 */
export function isResourceStreamLive(state: ApiResourceRuntimeState): boolean {
  if (!state.isRunning || state.refCount <= 0) return false;
  if (state.transport === "fallback") return state.fallbackSynced && state.error === null;
  return state.transport === "api" && state.lastListAt !== null && state.error === null;
}

const resourceStreamLiveness = writable<Record<string, boolean>>({});

function streamLivenessKey(scope: string, clusterId: string) {
  return `${scope}|${clusterId}`;
}

export function selectResourceStreamLive(scope: string, clusterId: string): Readable<boolean> {
  const key = streamLivenessKey(scope, clusterId);
  return derived(resourceStreamLiveness, ($liveness) => $liveness[key] ?? false);
}

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
  /** Liveness key for selectResourceStreamLive; defaults to kind. */
  scope?: string;
  setInitial: (clusterId: string, items: Item[]) => void;
  fallbackStart?: (clusterId: string, hooks: WatchLifecycleHooks) => void;
  fallbackStop?: (clusterId: string) => void;
}): ApiResourceSyncController<Item> {
  const active = new Map<string, ActiveSession>();
  const runtimeStates = writable<Record<string, ApiResourceRuntimeState>>({});

  function isClusterActive(clusterId: string) {
    return get(activeApiSyncClusterIds).includes(clusterId);
  }

  const scope = options.scope ?? options.kind;

  function updateRuntimeState(
    clusterId: string,
    updater: (prev: ApiResourceRuntimeState) => ApiResourceRuntimeState,
  ) {
    let next = DEFAULT_RUNTIME_STATE;
    runtimeStates.update((current) => {
      next = updater(current[clusterId] ?? DEFAULT_RUNTIME_STATE);
      return { ...current, [clusterId]: next };
    });
    const live = isResourceStreamLive(next);
    const key = streamLivenessKey(scope, clusterId);
    if ((get(resourceStreamLiveness)[key] ?? false) !== live) {
      resourceStreamLiveness.update((current) => ({ ...current, [key]: live }));
    }
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

  function clearFallbackRetry(session: ActiveSession) {
    if (!session.fallbackRetryTimer) return;
    clearTimeout(session.fallbackRetryTimer);
    session.fallbackRetryTimer = null;
  }

  function startFallback(clusterId: string, session: ActiveSession) {
    session.fallbackActive = true;
    session.fallbackDead = false;
    const generation = ++session.fallbackGeneration;
    const isCurrent = () => session.fallbackActive && session.fallbackGeneration === generation;
    updateRuntimeState(clusterId, (prev) => ({
      ...prev,
      isRunning: true,
      transport: "fallback",
      error: null,
      fallbackSynced: false,
    }));
    options.fallbackStart?.(clusterId, {
      onRelist: (items) => {
        if (!isCurrent()) return;
        options.setInitial(clusterId, items as Item[]);
        updateRuntimeState(clusterId, (prev) => ({ ...prev, error: null, fallbackSynced: true }));
      },
      onGiveUp: (reason) => {
        if (!isCurrent()) return;
        session.fallbackDead = true;
        updateRuntimeState(clusterId, (prev) => ({
          ...prev,
          error: reason,
          fallbackSynced: false,
        }));
        trackWatcherTransportError({
          clusterId,
          kind: options.kind,
          stage: "fallback",
          error: reason,
          retryCount: session.retryCount,
        });
      },
    });
  }

  function stopFallback(clusterId: string, session: ActiveSession) {
    clearFallbackRetry(session);
    if (!session.fallbackActive) return;
    session.fallbackActive = false;
    session.fallbackDead = false;
    session.fallbackGeneration += 1;
    options.fallbackStop?.(clusterId);
  }

  function scheduleFallbackRetry(clusterId: string, session: ActiveSession) {
    clearFallbackRetry(session);
    const delay = Math.min(
      FALLBACK_API_RETRY_BASE_MS * 2 ** session.fallbackRetryAttempt,
      FALLBACK_API_RETRY_MAX_MS,
    );
    session.fallbackRetryAttempt += 1;
    trackWatcherRetry({
      clusterId,
      kind: options.kind,
      retryCount: session.retryCount,
      backoffMs: delay,
      transport: "fallback",
    });
    session.fallbackRetryTimer = setTimeout(() => {
      session.fallbackRetryTimer = null;
      if (!session.fallbackActive || session.controller || session.refCount <= 0) return;
      if (!isClusterActive(clusterId)) return;
      // Try the API path while the fallback keeps running; runSession stops the
      // fallback once the list succeeds, or schedules the next try.
      session.controller = new AbortController();
      void runSession(clusterId, session);
    }, delay);
  }

  function stopSession(clusterId: string, session: ActiveSession) {
    session.controller?.abort();
    const stoppedTransport = session.fallbackActive ? "fallback" : "api";
    session.controller = null;
    stopFallback(clusterId, session);
    session.fallbackRetryAttempt = 0;
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
      startFallback(clusterId, session);
      scheduleFallbackRetry(clusterId, session);
    };

    try {
      const initial = await listWithResolvedPath(clusterId, controller.signal);
      // A retry from the fallback succeeded: the API watch takes over from the
      // list's resourceVersion, so nothing between the two is lost.
      stopFallback(clusterId, session);
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
            session.fallbackRetryAttempt = 0;
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
        session.fallbackRetryAttempt = 0;
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
      if (!controller.signal.aborted && session.fallbackActive) {
        // A retry from the fallback failed at the list: keep the fallback, bring
        // it back if it gave up, and try again later.
        if (session.fallbackDead) {
          stopFallback(clusterId, session);
          startFallback(clusterId, session);
        }
        scheduleFallbackRetry(clusterId, session);
        return;
      }
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
    // A running fallback watch is the session. Starting another API attempt on
    // every activity-store emission opened a new kubectl proxy each time, failed
    // the same way and flapped the stream state.
    if (session.controller || session.fallbackActive) return;
    session.controller = new AbortController();
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
        fallbackDead: false,
        fallbackGeneration: 0,
        fallbackRetryTimer: null,
        fallbackRetryAttempt: 0,
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
