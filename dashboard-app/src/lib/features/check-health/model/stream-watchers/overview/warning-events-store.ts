import { derived, get, writable, type Readable } from "svelte/store";
import type { WarningEventItem } from "../../types";
import { eventBus } from "../event-bus";
import type { WarningEventWatchEvent } from "./warning-events-parser";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 500;

type WarningEventStoreItem = WarningEventItem & { uid: string };

const state = writable<Record<string, WarningEventStoreItem[]>>({});

type RawWarningEvent = WarningEventWatchEvent["object"];

function toTimestamp(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEventTime(event: RawWarningEvent): number | null {
  return (
    toTimestamp(event.lastTimestamp) ??
    toTimestamp(event.eventTime) ??
    toTimestamp(event.firstTimestamp) ??
    toTimestamp(event.metadata?.creationTimestamp)
  );
}

function toEventUid(event: RawWarningEvent, timestamp: number): string {
  if (event.metadata?.uid) return event.metadata.uid;
  return [
    event.metadata?.namespace ?? "default",
    event.involvedObject?.kind ?? "Unknown",
    event.involvedObject?.name ?? "unknown",
    event.reason ?? "Unknown",
    timestamp,
  ].join(":");
}

function toStoreItem(event: RawWarningEvent): WarningEventStoreItem | null {
  if (event.type && event.type !== "Warning") return null;
  const timestamp = resolveEventTime(event);
  if (!timestamp) return null;
  if (Date.now() - timestamp > RETENTION_MS) return null;

  return {
    uid: toEventUid(event, timestamp),
    timestamp,
    type: event.type ?? "Warning",
    namespace: event.metadata?.namespace ?? "default",
    objectKind: event.involvedObject?.kind ?? "Unknown",
    objectName: event.involvedObject?.name ?? "unknown",
    reason: event.reason ?? "Unknown",
    message: event.message ?? "-",
    count: event.count ?? 1,
  };
}

function cleanupItems(items: WarningEventStoreItem[]): WarningEventStoreItem[] {
  const now = Date.now();
  return items
    .filter((item) => now - item.timestamp <= RETENTION_MS)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_EVENTS);
}

function updateForCluster(
  clusterId: string,
  updater: (prev: WarningEventStoreItem[]) => WarningEventStoreItem[],
) {
  state.update((all) => {
    const prev = all[clusterId] ?? [];
    return {
      ...all,
      [clusterId]: cleanupItems(updater(prev)),
    };
  });
}

eventBus.subscribe((event) => {
  if (event.kind !== "warning-event") return;
  const payload = event.payload as WarningEventWatchEvent;
  const raw = payload.object;
  const timestamp = resolveEventTime(raw);
  const uid = timestamp ? toEventUid(raw, timestamp) : (raw.metadata?.uid ?? null);
  if (!uid) return;

  if (payload.type === "DELETED") {
    updateForCluster(event.clusterId, (prev) => prev.filter((item) => item.uid !== uid));
    return;
  }

  const mapped = toStoreItem(raw);
  if (!mapped) return;
  updateForCluster(event.clusterId, (prev) => [
    ...prev.filter((item) => item.uid !== mapped.uid),
    mapped,
  ]);
});

export function setInitialOverviewWarningEvents(clusterId: string, items: WarningEventItem[]) {
  if (!clusterId) return;
  const normalized = items
    .map((item) => ({
      ...item,
      uid: [item.namespace, item.objectKind, item.objectName, item.reason, item.timestamp].join(
        ":",
      ),
    }))
    .slice(0, MAX_EVENTS);
  state.update((all) => ({
    ...all,
    [clusterId]: cleanupItems(normalized),
  }));
}

export function getOverviewWarningEventsSnapshot(clusterId: string): WarningEventItem[] {
  const rows = get(state)[clusterId] ?? [];
  return rows.map((row) => {
    const { uid, ...rest } = row;
    void uid;
    return rest;
  });
}

export function selectOverviewWarningEvents(clusterId: string): Readable<WarningEventItem[]> {
  return derived(state, ($state) => {
    const rows = $state[clusterId] ?? [];
    return rows.map((row) => {
      const { uid, ...rest } = row;
      void uid;
      return rest;
    });
  });
}
