export interface HumanizedCronReason {
  title: string;
  hint: string;
  category: "schedule" | "missed" | "failed" | "long_running" | "config" | "suspended" | "ok";
}

// Input is the raw reason string from cronjobs-health (joined with "; ").
export function humanizeCronReason(reason: string): HumanizedCronReason {
  const lower = (reason || "").toLowerCase();

  if (lower.includes("missing schedule")) {
    return {
      title: "spec.schedule is missing",
      hint: "Every CronJob needs a schedule expression. Add one (e.g. '0 3 * * *') and reapply; otherwise the controller cannot plan any runs.",
      category: "config",
    };
  }

  if (lower.includes("invalid schedule")) {
    return {
      title: "Schedule string is malformed",
      hint: "Cron fields must be exactly 5 (minute hour day-of-month month day-of-week). Validate with a cron tester. '*/5' cadence is supported; predefined macros like '@hourly' may not be recognized here.",
      category: "schedule",
    };
  }

  if (lower.includes("missed schedule")) {
    return {
      title: "CronJob missed its scheduled runs",
      hint: "Controller did not start a Job in time. Common causes: (1) `startingDeadlineSeconds` too small and controller-manager was briefly down, (2) `concurrencyPolicy: Forbid` with an active long-running Job, (3) API server / controller-manager failures, (4) suspended parent CronJob, (5) cluster clock skew.",
      category: "missed",
    };
  }

  if (lower.includes("last job failed")) {
    return {
      title: "Most recent Job run failed",
      hint: "The latest Job's pods exited with non-zero. Check pod logs (--previous) and Job events for OOM / timeout / exit code. If repeated, adjust resources / image / entrypoint before the next scheduled run.",
      category: "failed",
    };
  }

  if (lower.includes("no recent schedule")) {
    return {
      title: "CronJob has never been scheduled",
      hint: "Either the CronJob was just created, or the controller has not picked it up. If it has been minutes since creation, check controller-manager logs and suspend flag.",
      category: "missed",
    };
  }

  if (lower.includes("running longer")) {
    return {
      title: "Active Job is running past its interval",
      hint: "An active Job has been executing longer than 2x the schedule interval. Tune its workload (faster queries, smaller batches) or raise `activeDeadlineSeconds` if the duration is expected.",
      category: "long_running",
    };
  }

  if (lower.includes("suspended") || lower === "suspended") {
    return {
      title: "CronJob is suspended",
      hint: '`spec.suspend=true` prevents the controller from launching new runs. Un-suspend when you are ready: `kubectl patch cronjob <name> -n <ns> -p \'{"spec":{"suspend":false}}\'`',
      category: "suspended",
    };
  }

  if (lower === "ok" || !lower) {
    return {
      title: "CronJob is healthy",
      hint: "Schedule is valid, last run finished successfully, and no deadline was missed.",
      category: "ok",
    };
  }

  return {
    title: reason,
    hint: "Uncommon reason. Check CronJob status and recent events for context.",
    category: "config",
  };
}
