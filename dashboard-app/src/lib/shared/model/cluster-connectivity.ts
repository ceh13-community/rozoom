import { derived, get, writable, type Readable } from "svelte/store";
import { classifyKubectlFailure } from "$shared/lib/kubectl-connectivity";

/**
 * Per-cluster connectivity, independent of the Linter.
 *
 * Fed passively by every kubectl call the app makes for a cluster (see
 * kubectl-proxy) and by the health check, so it never runs a credential plugin
 * on its own. The only active check is the one the cluster page runs when it
 * opens and the Retry button.
 *
 * - unknown: nothing has talked to the cluster in this session yet.
 * - online: the API server answered (also with 403/404: that is the page's error).
 * - unreachable / auth-expired: the last call that reached the network failed.
 */
export type ClusterConnectivityState = "unknown" | "online" | "unreachable" | "auth-expired";

export type ClusterConnectivity = {
  state: ClusterConnectivityState;
  /** Visible one-line reason, only when unreachable or auth-expired. */
  reason: string | null;
  /** Raw last stderr line for the Details disclosure. */
  detail: string | null;
  /** A check is running. */
  checking: boolean;
  /** Last time the API server answered, persisted across restarts. */
  lastContactAt: number | null;
  /** Last version the API server reported, persisted across restarts. */
  lastKnownVersion: string | null;
  /** Last time any verdict was recorded in this session. */
  checkedAt: number | null;
};

const STORAGE_KEY = "rozoom:cluster-connectivity:v1";

// Only failures that are about reaching the server change the state. A local
// error (unknown flag, missing CRD in a client-side check) says nothing about
// the network and must not paint a live cluster as unreachable.
const NETWORK_OR_AUTH_FAILURE =
  /unable to connect to the server|dial tcp|no route to host|connection refused|was refused|no such host|i\/o timeout|deadline exceeded|tls handshake|x509|certificate|unauthorized|must be logged in|provide credentials|getting credentials|exec plugin|error from server|forbidden/i;

const EMPTY: ClusterConnectivity = {
  state: "unknown",
  reason: null,
  detail: null,
  checking: false,
  lastContactAt: null,
  lastKnownVersion: null,
  checkedAt: null,
};

type PersistedEntry = { lastContactAt: number | null; lastKnownVersion: string | null };

function loadPersisted(): Record<string, PersistedEntry> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<
      string,
      { lastContactAt?: unknown; lastKnownVersion?: unknown } | null
    > | null;
    const entries: Record<string, PersistedEntry> = {};
    for (const [clusterId, entry] of Object.entries(parsed ?? {})) {
      const lastContactAt = typeof entry?.lastContactAt === "number" ? entry.lastContactAt : null;
      const lastKnownVersion =
        typeof entry?.lastKnownVersion === "string" ? entry.lastKnownVersion : null;
      if (lastContactAt !== null || lastKnownVersion !== null) {
        entries[clusterId] = { lastContactAt, lastKnownVersion };
      }
    }
    return entries;
  } catch {
    return {};
  }
}

function initialState(): Record<string, ClusterConnectivity> {
  const state: Record<string, ClusterConnectivity> = {};
  for (const [clusterId, entry] of Object.entries(loadPersisted())) {
    state[clusterId] = { ...EMPTY, ...entry };
  }
  return state;
}

const store = writable<Record<string, ClusterConnectivity>>(initialState());

export const clusterConnectivity: Readable<Record<string, ClusterConnectivity>> = {
  subscribe: store.subscribe,
};

function persist(state: Record<string, ClusterConnectivity>) {
  try {
    const snapshot: Record<string, PersistedEntry> = {};
    for (const [clusterId, entry] of Object.entries(state)) {
      if (entry.lastContactAt === null && entry.lastKnownVersion === null) continue;
      snapshot[clusterId] = {
        lastContactAt: entry.lastContactAt,
        lastKnownVersion: entry.lastKnownVersion,
      };
    }
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // best effort: the lines are hidden when nothing is recorded
  }
}

// A cluster coming back is written at once; a steady one at most once a minute,
// which is enough for "Last successful contact: 14:02".
const PERSIST_EVERY_MS = 60_000;
let lastPersistAt = 0;

function currentEntry(clusterId: string): ClusterConnectivity | undefined {
  const entry: ClusterConnectivity | undefined = get(store)[clusterId];
  return entry;
}

function update(clusterId: string, patch: Partial<ClusterConnectivity>) {
  store.update((state) => ({
    ...state,
    [clusterId]: { ...(state[clusterId] ?? EMPTY), ...patch },
  }));
}

function markOnline(clusterId: string, now: number) {
  const wasOnline = currentEntry(clusterId)?.state === "online";
  update(clusterId, {
    state: "online",
    reason: null,
    detail: null,
    lastContactAt: now,
    checkedAt: now,
  });
  if (!wasOnline || now - lastPersistAt >= PERSIST_EVERY_MS) {
    lastPersistAt = now;
    persist(get(store));
  }
}

function markFailure(clusterId: string, stderr: string, now: number) {
  if (!NETWORK_OR_AUTH_FAILURE.test(stderr)) return;
  const verdict = classifyKubectlFailure(stderr);
  if (verdict.state === "online") {
    markOnline(clusterId, now);
    return;
  }
  update(clusterId, {
    state: verdict.state,
    reason: verdict.reason,
    detail: verdict.detail,
    checkedAt: now,
  });
}

function normalizeId(clusterId: string | null | undefined): string | null {
  const id = clusterId?.trim();
  return id ? id : null;
}

/**
 * Called by the kubectl proxy after every finished exec for a cluster. A null
 * code means kubectl was killed (abort or timeout): that says nothing about the
 * cluster, so it records no verdict.
 */
export function reportKubectlOutcome(
  clusterId: string | null | undefined,
  result: { code?: number | null; stderr: string },
) {
  const id = normalizeId(clusterId);
  if (!id || result.code === null) return;
  const now = Date.now();
  if (result.code === 0 || result.code === undefined) {
    markOnline(id, now);
    return;
  }
  markFailure(id, result.stderr, now);
}

/** Called by the health check after a fresh load that reached the cluster. */
export function reportClusterAnswered(clusterId: string | null | undefined) {
  const id = normalizeId(clusterId);
  if (id) markOnline(id, Date.now());
}

/** Called by the health check with the error text of a failed load. */
export function reportClusterLoadError(clusterId: string | null | undefined, errorText: string) {
  const id = normalizeId(clusterId);
  if (!id) return;
  markFailure(id, errorText, Date.now());
}

/** A check gave up waiting: the server neither answered nor refused. */
export function reportClusterNoAnswer(clusterId: string, detail: string) {
  update(clusterId, {
    state: "unreachable",
    reason: "No answer from the server",
    detail,
    checkedAt: Date.now(),
  });
}

export function recordServerVersion(clusterId: string, version: string) {
  const trimmed = version.trim();
  if (!trimmed || currentEntry(clusterId)?.lastKnownVersion === trimmed) return;
  update(clusterId, { lastKnownVersion: trimmed });
  persist(get(store));
}

export function setClusterConnectivityChecking(clusterId: string, checking: boolean) {
  update(clusterId, { checking });
}

export function getClusterConnectivity(clusterId: string): ClusterConnectivity {
  return get(store)[clusterId] ?? EMPTY;
}

export function selectClusterConnectivity(clusterId: string): Readable<ClusterConnectivity> {
  return derived(store, (state) => state[clusterId] ?? EMPTY);
}

export function isClusterDisconnected(entry: Pick<ClusterConnectivity, "state">): boolean {
  return entry.state === "unreachable" || entry.state === "auth-expired";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:02" today, "15 Nov 14:02" on another day, in local time. */
export function formatContactTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

/** Test seam. */
export function resetClusterConnectivity() {
  lastPersistAt = 0;
  store.set(initialState());
}
