import { derived, get, writable, type Readable } from "svelte/store";
import { classifyKubectlFailure } from "$shared/lib/kubectl-connectivity";

/**
 * Per-cluster connectivity, independent of the Linter.
 *
 * Fed passively by every kubectl call the app makes for a cluster (see
 * kubectl-proxy) and by the health check. Errors that prove the state (refused,
 * no route, unknown host, untrusted certificate, rejected credentials) are
 * written at once. A timeout is not proof: it asks for the connectivity check
 * (one small request), and only the check writes "unreachable" for it. The
 * check also runs when a cluster page opens and on Retry.
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

// A steady cluster answers on every call. Rewriting the store each time would
// re-render every card and page that reads it, for times shown in minutes.
const ONLINE_REWRITE_EVERY_MS = 15_000;

// A timeout on an ordinary call asks for one check, at most this often.
const CONFIRMATION_EVERY_MS = 30_000;

// A cluster that answers again makes each view reload, at most this often.
const RECONNECT_RELOAD_EVERY_MS = 60_000;

/** `source` of the kubectl call made by the connectivity check itself. */
export const CONNECTIVITY_CHECK_SOURCE = "cluster-connectivity:check";

/** When the call behind a report started, and who made it. */
export type ConnectivityReport = {
  /** Defaults to the time of the report. */
  startedAt?: number;
  source?: string | null;
};

// Start time of the call behind the current verdict. Calls finish in any order:
// a list that hung for 10 s must not overwrite what a Retry started 5 s later
// has already found out, in either direction.
const verdictStartedAt = new Map<string, number>();
const lastConfirmationAt = new Map<string, number>();
const lastReconnectReloadAt = new Map<string, number>();
let confirmationRunner: ((clusterId: string) => void) | null = null;

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

function isStale(clusterId: string, startedAt: number): boolean {
  const recorded = verdictStartedAt.get(clusterId);
  return recorded !== undefined && startedAt < recorded;
}

/** Records the call as the source of the verdict, unless a newer one already is. */
function claimVerdict(clusterId: string, startedAt: number): boolean {
  if (isStale(clusterId, startedAt)) return false;
  verdictStartedAt.set(clusterId, startedAt);
  return true;
}

function markOnline(clusterId: string, startedAt: number, now: number) {
  if (!claimVerdict(clusterId, startedAt)) return;
  const entry = currentEntry(clusterId);
  if (
    entry?.state === "online" &&
    entry.checkedAt !== null &&
    now - entry.checkedAt < ONLINE_REWRITE_EVERY_MS
  ) {
    return;
  }
  const wasOnline = entry?.state === "online";
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

function requestConfirmation(clusterId: string, now: number) {
  const last = lastConfirmationAt.get(clusterId);
  if (last !== undefined && now - last < CONFIRMATION_EVERY_MS) return;
  lastConfirmationAt.set(clusterId, now);
  confirmationRunner?.(clusterId);
}

function markFailure(
  clusterId: string,
  stderr: string,
  startedAt: number,
  authoritative: boolean,
  now: number,
) {
  if (!NETWORK_OR_AUTH_FAILURE.test(stderr)) return;
  const verdict = classifyKubectlFailure(stderr);
  if (verdict.state === "online") {
    markOnline(clusterId, startedAt, now);
    return;
  }
  if (!verdict.definite && !authoritative) {
    // One slow request on a live cluster times out the same way a dead cluster
    // does. It changes nothing by itself; the check decides.
    if (isStale(clusterId, startedAt)) return;
    if (!isClusterDisconnected(currentEntry(clusterId) ?? EMPTY)) {
      requestConfirmation(clusterId, now);
    }
    return;
  }
  if (!claimVerdict(clusterId, startedAt)) return;
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
 * The connectivity check registers itself here, so a timeout on an ordinary call
 * can ask for it without this store importing the kubectl proxy.
 */
export function registerConnectivityConfirmation(runner: ((clusterId: string) => void) | null) {
  confirmationRunner = runner;
}

/**
 * Called by the kubectl proxy after every finished exec for a cluster. A null
 * code means kubectl was killed: that says nothing about the cluster, so it
 * records no verdict.
 */
export function reportKubectlOutcome(
  clusterId: string | null | undefined,
  result: { code?: number | null; stderr: string },
  report: ConnectivityReport = {},
) {
  const id = normalizeId(clusterId);
  if (!id || result.code === null) return;
  const now = Date.now();
  const startedAt = report.startedAt ?? now;
  if (result.code === 0 || result.code === undefined) {
    markOnline(id, startedAt, now);
    return;
  }
  markFailure(id, result.stderr, startedAt, report.source === CONNECTIVITY_CHECK_SOURCE, now);
}

/** Called by the health check after a fresh load that reached the cluster. */
export function reportClusterAnswered(clusterId: string | null | undefined, startedAt?: number) {
  const id = normalizeId(clusterId);
  if (!id) return;
  const now = Date.now();
  markOnline(id, startedAt ?? now, now);
}

/** Called with the error text of a failed load (health check) or check. */
export function reportClusterLoadError(
  clusterId: string | null | undefined,
  errorText: string,
  report: ConnectivityReport = {},
) {
  const id = normalizeId(clusterId);
  if (!id) return;
  const now = Date.now();
  markFailure(
    id,
    errorText,
    report.startedAt ?? now,
    report.source === CONNECTIVITY_CHECK_SOURCE,
    now,
  );
}

/** The check gave up waiting: the server neither answered nor refused. */
export function reportClusterNoAnswer(clusterId: string, detail: string, startedAt?: number) {
  const now = Date.now();
  if (!claimVerdict(clusterId, startedAt ?? now)) return;
  update(clusterId, {
    state: "unreachable",
    reason: "No answer from the server",
    detail,
    checkedAt: now,
  });
}

/**
 * A view asks before reloading because the cluster answered again. True at most
 * once a minute per cluster and view, so a cluster that keeps dropping cannot
 * turn every return into a full reload of the card, the list and the pods.
 */
export function claimReconnectReload(clusterId: string, view: string, now = Date.now()): boolean {
  const key = `${clusterId}::${view}`;
  const last = lastReconnectReloadAt.get(key);
  if (last !== undefined && now - last < RECONNECT_RELOAD_EVERY_MS) return false;
  lastReconnectReloadAt.set(key, now);
  return true;
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
  verdictStartedAt.clear();
  lastConfirmationAt.clear();
  lastReconnectReloadAt.clear();
  store.set(initialState());
}
