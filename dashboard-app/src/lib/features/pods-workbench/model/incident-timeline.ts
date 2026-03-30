import type { PodEvent } from "$features/pod-details";

export type IncidentMarkerKind = "logs" | "events" | "restart" | "oom";
export type IncidentMarkerSeverity = "info" | "warning";

export type IncidentMarker = {
  id: string;
  kind: IncidentMarkerKind;
  severity: IncidentMarkerSeverity;
  ts: number;
  label: string;
  detail: string;
  line?: number;
  eventIndex?: number;
};

type RestartPoint = {
  container: string;
  ts: number;
  detail: string;
};

const ISO_LIKE_TS = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/;

function parseTime(input: string | undefined): number | null {
  if (!input || input === "-") return null;
  const value = Date.parse(input);
  return Number.isFinite(value) ? value : null;
}

function extractTimestamp(line: string): number | null {
  const match = line.match(ISO_LIKE_TS);
  if (!match) return null;
  const value = Date.parse(match[0].endsWith("Z") ? match[0] : `${match[0]}Z`);
  return Number.isFinite(value) ? value : null;
}

export function extractRestartPoints(pod: unknown): RestartPoint[] {
  const podStatus = pod as { status?: { containerStatuses?: Array<Record<string, unknown>> } };
  const statuses = podStatus.status?.containerStatuses;
  if (!Array.isArray(statuses)) return [];
  const markers: RestartPoint[] = [];
  for (const status of statuses) {
    const container =
      typeof status.name === "string" && status.name.length > 0 ? status.name : "container";
    const lastFinished = parseTime(
      (status.lastState as { terminated?: { finishedAt?: string } } | undefined)?.terminated
        ?.finishedAt,
    );
    if (lastFinished) {
      markers.push({
        container,
        ts: lastFinished,
        detail: `${container} terminated`,
      });
    }
    const started = parseTime(
      (status.state as { running?: { startedAt?: string } } | undefined)?.running?.startedAt,
    );
    if (started) {
      markers.push({
        container,
        ts: started,
        detail: `${container} started`,
      });
    }
  }
  return markers;
}

export function buildIncidentTimeline(input: {
  logs: string;
  events: PodEvent[];
  restartPoints: RestartPoint[];
}): IncidentMarker[] {
  const markers: IncidentMarker[] = [];
  const lines = input.logs.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const ts = extractTimestamp(line);
    if (!ts) continue;
    const lower = line.toLowerCase();
    const isInteresting =
      /\b(error|warn|fail|exception|crash|timeout|refused)\b/.test(lower) ||
      lower.includes("oomkilled");
    if (!isInteresting && index % 120 !== 0) continue;
    markers.push({
      id: `logs:${index + 1}`,
      kind: lower.includes("oomkilled") ? "oom" : "logs",
      severity: isInteresting ? "warning" : "info",
      ts,
      label: lower.includes("oomkilled") ? "OOM" : "Log",
      detail: line.trim().slice(0, 180) || `Line ${index + 1}`,
      line: index + 1,
    });
  }

  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index];
    const ts = parseTime(event.lastTimestamp);
    if (!ts) continue;
    markers.push({
      id: `event:${index}`,
      kind: "events",
      severity: event.type.toLowerCase() === "warning" ? "warning" : "info",
      ts,
      label: event.reason || event.type || "Event",
      detail: event.message || "-",
      eventIndex: index,
    });
  }

  for (let index = 0; index < input.restartPoints.length; index += 1) {
    const restart = input.restartPoints[index];
    markers.push({
      id: `restart:${index}`,
      kind: "restart",
      severity: "warning",
      ts: restart.ts,
      label: "Restart",
      detail: restart.detail,
    });
  }

  const deduped = new Map<string, IncidentMarker>();
  for (const marker of markers) {
    const key = `${marker.kind}:${marker.ts}:${marker.label}:${marker.line ?? "-"}:${marker.eventIndex ?? "-"}`;
    if (!deduped.has(key)) {
      deduped.set(key, marker);
    }
  }
  return [...deduped.values()].sort((a, b) => a.ts - b.ts);
}
