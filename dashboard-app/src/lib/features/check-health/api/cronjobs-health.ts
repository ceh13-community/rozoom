import type { CronJobItem, CronJobs, JobItem, Jobs } from "$shared/model/clusters";
import type { CronJobsHealth, CronJobHealthItem, CronJobHealthStatus } from "../model/types";

// Schedule drift thresholds are intentionally conservative to reduce false positives.
const MISSED_SCHEDULE_FACTOR = 2;
const CRITICAL_SCHEDULE_FACTOR = 3;

const DEFAULT_CRON_HEALTH: CronJobsHealth = {
  items: [],
  summary: {
    total: 0,
    ok: 0,
    warning: 0,
    critical: 0,
    unknown: 0,
  },
  updatedAt: Date.now(),
};

type CronField = {
  type: "any" | "every" | "specific";
  value?: number;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

function parseCronField(field: string): CronField | null {
  if (field === "*") return { type: "any" };

  if (field.startsWith("*/")) {
    const value = Number.parseInt(field.slice(2), 10);
    if (Number.isFinite(value) && value > 0) {
      return { type: "every", value };
    }
    return null;
  }

  const numeric = Number.parseInt(field, 10);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return { type: "specific", value: numeric };
  }

  return null;
}

function getCronIntervalMs(schedule: string): {
  intervalMs: number | null;
  error?: string;
} {
  try {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) {
      return { intervalMs: null, error: "Invalid schedule format" };
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const minuteField = parseCronField(minute);
    const hourField = parseCronField(hour);
    const domField = parseCronField(dayOfMonth);
    const monthField = parseCronField(month);
    const dowField = parseCronField(dayOfWeek);

    if (!minuteField || !hourField || !domField || !monthField || !dowField) {
      return { intervalMs: null, error: "Invalid schedule format" };
    }

    // Evaluate common cron patterns first, fallback to daily cadence.
    if (minuteField.type === "every" && minuteField.value !== undefined) {
      return { intervalMs: minuteField.value * MINUTE_MS };
    }

    if (hourField.type === "every" && hourField.value !== undefined) {
      return { intervalMs: hourField.value * HOUR_MS };
    }

    if (domField.type === "every" && domField.value !== undefined) {
      return { intervalMs: domField.value * DAY_MS };
    }

    if (dowField.type === "every" && dowField.value !== undefined) {
      return { intervalMs: dowField.value * DAY_MS };
    }

    if (monthField.type === "every" && monthField.value !== undefined) {
      return { intervalMs: monthField.value * MONTH_MS };
    }

    if (minuteField.type === "any") {
      return { intervalMs: MINUTE_MS };
    }

    if (hourField.type === "any") {
      return { intervalMs: HOUR_MS };
    }

    return { intervalMs: DAY_MS };
  } catch (err) {
    return {
      intervalMs: null,
      error: err instanceof Error ? err.message : "Invalid schedule",
    };
  }
}

type CronJobJobIndex = Map<string, JobItem[]>;

function buildCronJobJobIndex(jobs: JobItem[]): CronJobJobIndex {
  const index = new Map<string, JobItem[]>();

  for (const job of jobs) {
    const namespace = job.metadata.namespace ?? "default";
    const keySet = new Set<string>();

    for (const owner of job.metadata.ownerReferences ?? []) {
      if (owner.kind === "CronJob") {
        keySet.add(`${namespace}/${owner.name}`);
      }
    }

    const labelName = job.metadata.labels?.["cronjob-name"];
    if (labelName) {
      keySet.add(`${namespace}/${labelName}`);
    }

    for (const key of keySet) {
      const current = index.get(key);
      if (current) {
        current.push(job);
      } else {
        index.set(key, [job]);
      }
    }
  }

  return index;
}

function getCronJobJobs(cronJob: CronJobItem, index: CronJobJobIndex, fallbackJobs: JobItem[]) {
  const cronJobName = cronJob.metadata.name;
  const cronJobNamespace = cronJob.metadata.namespace ?? "default";
  const indexed = index.get(`${cronJobNamespace}/${cronJobName}`);
  if (indexed) return indexed;

  return fallbackJobs.filter((job) => {
    if (job.metadata.namespace !== cronJobNamespace) {
      return false;
    }

    const ownerMatch = job.metadata.ownerReferences?.some(
      (owner) => owner.kind === "CronJob" && owner.name === cronJobName,
    );

    if (ownerMatch) {
      return true;
    }

    return job.metadata.labels?.["cronjob-name"] === cronJobName;
  });
}

function getJobStartTime(job: JobItem): Date | null {
  const startTime = job.status.startTime;
  if (startTime) return new Date(startTime);

  const createdAt = job.metadata.creationTimestamp;
  return new Date(createdAt);
}

function getLatestJob(jobs: JobItem[]): JobItem | null {
  if (jobs.length === 0) return null;

  return [...jobs]
    .map((job) => ({
      job,
      start: getJobStartTime(job)?.getTime() ?? 0,
      createdAt: new Date(job.metadata.creationTimestamp).getTime(),
    }))
    .sort((a, b) => (b.start || b.createdAt) - (a.start || a.createdAt))[0].job;
}

function isJobFailed(job: JobItem): boolean {
  const hasFailedCondition = job.status.conditions?.some(
    (condition) => condition.type === "Failed" && condition.status === "True",
  );

  return (job.status.failed ?? 0) > 0 || Boolean(hasFailedCondition);
}

function isJobRunningTooLong(job: JobItem, intervalMs: number, reference: Date): boolean {
  if ((job.status.active ?? 0) === 0) return false;

  const startTime = getJobStartTime(job);
  if (!startTime) return false;

  const durationMs = reference.getTime() - startTime.getTime();
  return durationMs > intervalMs * MISSED_SCHEDULE_FACTOR;
}

function resolveStatus(
  reasons: string[],
  status: CronJobHealthStatus,
  nextStatus: CronJobHealthStatus,
) {
  if (nextStatus === "critical") {
    return { status: "critical" as const, reasons };
  }

  if (status === "critical") {
    return { status, reasons };
  }

  if (nextStatus === "warning") {
    return { status: "warning" as const, reasons };
  }

  return { status, reasons };
}

function evaluateCronJob(
  cronJob: CronJobItem,
  jobs: JobItem[],
  index: CronJobJobIndex,
  reference: Date,
): CronJobHealthItem {
  const schedule = cronJob.spec.schedule ?? "-";
  const lastScheduleTime = cronJob.status.lastScheduleTime
    ? new Date(cronJob.status.lastScheduleTime).toISOString()
    : undefined;
  const lastSuccessfulTime = cronJob.status.lastSuccessfulTime
    ? new Date(cronJob.status.lastSuccessfulTime).toISOString()
    : undefined;

  let status: CronJobHealthStatus = "ok";
  const reasons: string[] = [];

  if (!cronJob.spec.schedule) {
    status = "warning";
    reasons.push("Missing schedule");
  }

  const { intervalMs, error } =
    schedule !== "-"
      ? getCronIntervalMs(schedule)
      : {
          intervalMs: null,
          error: "Invalid schedule",
        };

  if (error) {
    status = "warning";
    reasons.push("Invalid schedule");
  }

  if (intervalMs && lastScheduleTime) {
    const lastScheduleDate = new Date(lastScheduleTime);
    const timeSince = reference.getTime() - lastScheduleDate.getTime();

    if (timeSince > intervalMs * CRITICAL_SCHEDULE_FACTOR) {
      const resolved = resolveStatus(reasons, status, "critical");
      status = resolved.status;
      reasons.push("Missed schedule");
    } else if (timeSince > intervalMs * MISSED_SCHEDULE_FACTOR) {
      const resolved = resolveStatus(reasons, status, "warning");
      status = resolved.status;
      reasons.push("Missed schedule");
    }
  } else if (!lastScheduleTime) {
    const resolved = resolveStatus(reasons, status, "warning");
    status = resolved.status;
    reasons.push("No recent schedule");
  }

  const cronJobJobs = getCronJobJobs(cronJob, index, jobs);
  const latestJob = getLatestJob(cronJobJobs);
  // Prefer active job runtime when available; fallback to the latest job timing.
  const activeJobNames = cronJob.status.active?.map((job) => job.name) ?? [];
  const activeJobs = cronJobJobs.filter((job) => activeJobNames.includes(job.metadata.name));

  if (latestJob && isJobFailed(latestJob)) {
    const resolved = resolveStatus(reasons, status, "warning");
    status = resolved.status;
    reasons.push("Last job failed");
  }

  const longRunningJob =
    intervalMs &&
    (activeJobs.length
      ? activeJobs.some((job) => isJobRunningTooLong(job, intervalMs, reference))
      : latestJob
        ? isJobRunningTooLong(latestJob, intervalMs, reference)
        : false);

  if (longRunningJob) {
    const resolved = resolveStatus(reasons, status, "warning");
    status = resolved.status;
    reasons.push("Job running longer than expected");
  }

  if (reasons.length === 0) {
    reasons.push("OK");
  }

  return {
    namespace: cronJob.metadata.namespace ?? "-",
    name: cronJob.metadata.name,
    schedule,
    lastScheduleTime,
    lastSuccessfulTime,
    status,
    reason: reasons.join("; "),
  };
}

export function buildCronJobsHealth(
  cronJobsData?: CronJobs,
  jobsData?: Jobs,
  reference = new Date(),
): CronJobsHealth {
  if (!cronJobsData?.items) {
    return {
      ...DEFAULT_CRON_HEALTH,
      updatedAt: reference.getTime(),
      error: "CronJobs data unavailable",
    };
  }

  const jobs = jobsData?.items ?? [];
  const jobIndex = buildCronJobJobIndex(jobs);
  const items = cronJobsData.items.map((cronJob) =>
    evaluateCronJob(cronJob, jobs, jobIndex, reference),
  );

  const summary = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.status] += 1;
      return acc;
    },
    {
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      unknown: 0,
    },
  );

  return {
    items,
    summary,
    updatedAt: reference.getTime(),
    error: jobsData?.items ? undefined : "Jobs data unavailable",
  };
}
