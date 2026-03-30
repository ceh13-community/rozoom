import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { WarningEventItem, WarningEventsReport, WarningEventsStatus } from "../model/types";

const CACHE_MS = 30 * 1000;
const REQUEST_TIMEOUT = "10s";
const KUBECTL_CALL_TIMEOUT_MS = 12_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 500;
const WARNING_THRESHOLD = 5;
const CRITICAL_THRESHOLD = 15;

const cachedReports = new Map<string, { data: WarningEventsReport; fetchedAt: number }>();

type RawEventObject = {
  kind?: string;
  name?: string;
};

type RawEvent = {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: { namespace?: string; creationTimestamp?: string };
  involvedObject?: RawEventObject;
};

type RawEventList = {
  items?: RawEvent[];
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

function parseJson(raw: string): RawEventList | null {
  try {
    return JSON.parse(raw) as RawEventList;
  } catch {
    return null;
  }
}

function toTimestamp(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEventTime(event: RawEvent): number | null {
  return (
    toTimestamp(event.lastTimestamp) ??
    toTimestamp(event.eventTime) ??
    toTimestamp(event.firstTimestamp) ??
    toTimestamp(event.metadata?.creationTimestamp)
  );
}

function mapEvents(events: RawEvent[]): WarningEventItem[] {
  const now = Date.now();
  const items: WarningEventItem[] = [];

  for (const event of events) {
    if (event.type && event.type !== "Warning") continue;
    const timestamp = resolveEventTime(event);
    if (!timestamp || now - timestamp > RETENTION_MS) continue;

    items.push({
      timestamp,
      type: event.type ?? "Warning",
      namespace: event.metadata?.namespace ?? "default",
      objectKind: event.involvedObject?.kind ?? "Unknown",
      objectName: event.involvedObject?.name ?? "unknown",
      reason: event.reason ?? "Unknown",
      message: event.message ?? "-",
      count: event.count ?? 1,
    });
  }

  return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_EVENTS);
}

function summarize(
  items: WarningEventItem[],
  errorMessage?: string,
): { status: WarningEventsStatus; warnings: string[]; message?: string } {
  if (errorMessage) {
    return {
      status: "unknown",
      warnings: [errorMessage],
      message: "Warning events unavailable.",
    };
  }

  const now = Date.now();
  const last30 = items.filter((item) => now - item.timestamp <= 30 * 60 * 1000);
  const warnings: string[] = [];

  const hasNodeNotReady = last30.some(
    (item) => item.objectKind.toLowerCase() === "node" && item.reason.toLowerCase() === "notready",
  );

  let status: WarningEventsStatus = "ok";
  if (hasNodeNotReady || last30.length >= CRITICAL_THRESHOLD) {
    status = "critical";
    if (hasNodeNotReady) warnings.push("NodeNotReady warning detected.");
    if (last30.length >= CRITICAL_THRESHOLD)
      warnings.push("Warning events exceed critical threshold.");
  } else if (last30.length >= WARNING_THRESHOLD) {
    status = "warning";
    warnings.push("Warning events exceed warning threshold.");
  }

  const topReasons = new Map<string, number>();
  for (const item of last30) {
    topReasons.set(item.reason, (topReasons.get(item.reason) ?? 0) + item.count);
  }
  const top = [...topReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason]) => reason)
    .join(", ");

  const message = `Warnings last 30m: ${last30.length}${top ? ` · Top: ${top}` : ""}`;

  return { status, warnings, message };
}

export async function checkWarningEvents(
  clusterId: string,
  options?: { force?: boolean },
): Promise<WarningEventsReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let items: WarningEventItem[] = [];

  try {
    const result = await withTimeout(
      kubectlRawFront(
        `get events --all-namespaces --field-selector type=Warning -o json --request-timeout=${REQUEST_TIMEOUT}`,
        { clusterId },
      ),
      KUBECTL_CALL_TIMEOUT_MS,
      "warning-events kubectl call",
    );
    if (result.errors || result.code !== 0) {
      errorMessage = result.errors || "Failed to fetch warning events.";
      await logError(`Warning events fetch failed: ${errorMessage}`);
    } else {
      const parsed = parseJson(result.output);
      items = parsed?.items ? mapEvents(parsed.items) : [];
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch warning events.";
    await logError(`Warning events fetch failed: ${errorMessage}`);
  }

  const summary = summarize(items, errorMessage);
  const report: WarningEventsReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
