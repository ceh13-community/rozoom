// Small, dependency-free cron decoder for the common cases we see in K8s
// CronJobs. Not a full replacement for cronstrue; targets the ~90% of real
// schedules (every N minutes/hours, specific time daily, weekly, monthly).

export interface ScheduleSummary {
  humanReadable: string;
  intervalMs: number | null;
  valid: boolean;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const DOW_NAMES: Record<string, string> = {
  "0": "Sun",
  "1": "Mon",
  "2": "Tue",
  "3": "Wed",
  "4": "Thu",
  "5": "Fri",
  "6": "Sat",
  "7": "Sun",
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

function isEveryN(field: string): number | null {
  const m = field.match(/^\*\/(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isNumeric(field: string): number | null {
  const n = Number.parseInt(field, 10);
  return Number.isFinite(n) && String(n) === field.trim() ? n : null;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const PREDEFINED: Record<string, ScheduleSummary | undefined> = {
  "@hourly": { humanReadable: "every hour", intervalMs: HOUR_MS, valid: true },
  "@daily": { humanReadable: "every day at 00:00", intervalMs: DAY_MS, valid: true },
  "@midnight": { humanReadable: "every day at 00:00", intervalMs: DAY_MS, valid: true },
  "@weekly": { humanReadable: "every Sunday at 00:00", intervalMs: WEEK_MS, valid: true },
  "@monthly": {
    humanReadable: "on the 1st of every month at 00:00",
    intervalMs: 30 * DAY_MS,
    valid: true,
  },
  "@yearly": { humanReadable: "on Jan 1 at 00:00", intervalMs: 365 * DAY_MS, valid: true },
  "@annually": { humanReadable: "on Jan 1 at 00:00", intervalMs: 365 * DAY_MS, valid: true },
};

export function describeSchedule(schedule: string | undefined | null): ScheduleSummary {
  if (!schedule || !schedule.trim()) {
    return { humanReadable: "(no schedule)", intervalMs: null, valid: false };
  }
  const trimmed = schedule.trim();
  const predefined = PREDEFINED[trimmed.toLowerCase()];
  if (predefined) return predefined;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      humanReadable: `invalid (expected 5 fields, got ${parts.length})`,
      intervalMs: null,
      valid: false,
    };
  }
  const minute = parts[0];
  const hour = parts[1];
  const dom = parts[2];
  const month = parts[3];
  const dow = parts[4];

  // Every N minutes
  const everyMin = isEveryN(minute);
  if (everyMin !== null && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return {
      humanReadable: `every ${everyMin} minute${everyMin === 1 ? "" : "s"}`,
      intervalMs: everyMin * MINUTE_MS,
      valid: true,
    };
  }

  // Every N hours on a specific minute
  const everyHour = isEveryN(hour);
  if (everyHour !== null && dom === "*" && month === "*" && dow === "*") {
    const min = isNumeric(minute);
    const minStr = min !== null ? `at :${pad(min)}` : "";
    return {
      humanReadable: `every ${everyHour} hour${everyHour === 1 ? "" : "s"} ${minStr}`.trim(),
      intervalMs: everyHour * HOUR_MS,
      valid: true,
    };
  }

  // Daily at HH:MM
  const minN = isNumeric(minute);
  const hourN = isNumeric(hour);
  if (minN !== null && hourN !== null && dom === "*" && month === "*" && dow === "*") {
    return {
      humanReadable: `every day at ${pad(hourN)}:${pad(minN)}`,
      intervalMs: DAY_MS,
      valid: true,
    };
  }

  // Weekly: minute + hour + dow specific
  if (minN !== null && hourN !== null && dom === "*" && month === "*" && dow !== "*") {
    const dowName = DOW_NAMES[dow.toLowerCase()] ?? `day-${dow}`;
    return {
      humanReadable: `weekly on ${dowName} at ${pad(hourN)}:${pad(minN)}`,
      intervalMs: WEEK_MS,
      valid: true,
    };
  }

  // Monthly: minute + hour + day-of-month
  const domN = isNumeric(dom);
  if (minN !== null && hourN !== null && domN !== null && month === "*" && dow === "*") {
    const ordinal = domN === 1 ? "1st" : domN === 2 ? "2nd" : domN === 3 ? "3rd" : `${domN}th`;
    return {
      humanReadable: `monthly on the ${ordinal} at ${pad(hourN)}:${pad(minN)}`,
      intervalMs: 30 * DAY_MS,
      valid: true,
    };
  }

  // Hourly at :00
  if (minute === "0" && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return { humanReadable: "every hour at :00", intervalMs: HOUR_MS, valid: true };
  }

  return { humanReadable: trimmed, intervalMs: DAY_MS, valid: true };
}

// Compute next schedule time from `schedule` and a `lastScheduleTime`.
// This is a heuristic (uses interval) rather than a real cron next-match; for
// our triage surface ("5m from now", "overdue by 2h") that is good enough.
export function computeNextRun(
  schedule: string,
  lastScheduleTime: string | undefined | null,
): { nextAt: Date; overdueBy: number } | null {
  const summary = describeSchedule(schedule);
  if (!summary.valid || !summary.intervalMs) return null;
  const last = lastScheduleTime ? Date.parse(lastScheduleTime) : NaN;
  const base = Number.isFinite(last) ? last : Date.now() - summary.intervalMs;
  const next = base + summary.intervalMs;
  const overdueBy = Math.max(0, Date.now() - next);
  return { nextAt: new Date(next), overdueBy };
}

export function formatDurationShort(ms: number): string {
  if (ms <= 0) return "now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}
