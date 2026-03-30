import { describe, it, expect } from "vitest";
import { buildCronJobsHealth } from "./cronjobs-health";
import type { CronJobs, Jobs } from "$shared/model/clusters";

const reference = new Date("2025-01-01T00:00:00Z");

describe("buildCronJobsHealth", () => {
  it("returns unavailable when cronjobs data is missing", () => {
    const result = buildCronJobsHealth(undefined, undefined, reference);

    expect(result.error).toBe("CronJobs data unavailable");
    expect(result.summary.total).toBe(0);
  });

  it("returns warning when jobs data is missing", () => {
    const cronJobs: CronJobs = {
      items: [
        {
          metadata: {
            name: "nightly",
            namespace: "default",
            creationTimestamp: new Date("2024-12-31T00:00:00Z"),
          },
          spec: {
            schedule: "0 * * * *",
          },
          status: {
            lastScheduleTime: new Date("2024-12-31T23:00:00Z"),
          },
        },
      ],
    };

    const result = buildCronJobsHealth(cronJobs, undefined, reference);

    expect(result.error).toBe("Jobs data unavailable");
    expect(result.summary.total).toBe(1);
  });

  it("flags missed schedules as critical", () => {
    const cronJobs: CronJobs = {
      items: [
        {
          metadata: {
            name: "nightly",
            namespace: "default",
            creationTimestamp: new Date("2024-12-31T00:00:00Z"),
          },
          spec: {
            schedule: "*/5 * * * *",
          },
          status: {
            lastScheduleTime: new Date("2024-12-31T23:20:00Z"),
          },
        },
      ],
    };

    const jobs: Jobs = { items: [] };

    const result = buildCronJobsHealth(cronJobs, jobs, reference);

    expect(result.items[0].status).toBe("critical");
    expect(result.items[0].reason).toContain("Missed schedule");
  });

  it("marks last failed job as warning", () => {
    const cronJobs: CronJobs = {
      items: [
        {
          metadata: {
            name: "backup",
            namespace: "default",
            creationTimestamp: new Date("2024-12-31T00:00:00Z"),
          },
          spec: {
            schedule: "0 * * * *",
          },
          status: {
            lastScheduleTime: new Date("2024-12-31T23:00:00Z"),
          },
        },
      ],
    };

    const jobs: Jobs = {
      items: [
        {
          metadata: {
            name: "backup-123",
            namespace: "default",
            creationTimestamp: new Date("2024-12-31T23:00:00Z"),
            ownerReferences: [{ kind: "CronJob", name: "backup" }],
          },
          spec: {},
          status: {
            failed: 1,
          },
        },
      ],
    };

    const result = buildCronJobsHealth(cronJobs, jobs, reference);

    expect(result.items[0].status).toBe("warning");
    expect(result.items[0].reason).toContain("Last job failed");
  });
});
