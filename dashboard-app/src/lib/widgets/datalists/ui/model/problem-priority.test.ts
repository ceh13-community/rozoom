import { describe, expect, it } from "vitest";
import {
  buildDaemonSetProblemScore,
  buildDeploymentProblemScore,
  buildCronJobProblemScore,
  buildJobProblemScore,
  buildNodeProblemSignals,
  buildPodProblemSignals,
  buildReplicaSetProblemScore,
  buildStatefulSetProblemScore,
  parsePercentValue,
  percentSeverity,
} from "./problem-priority";

describe("problem-priority", () => {
  it("parses percent strings and maps severity", () => {
    expect(parsePercentValue("91%")).toBe(91);
    expect(parsePercentValue("N/A")).toBeNull();
    expect(percentSeverity("86%")).toBe("warning");
    expect(percentSeverity("96%")).toBe("critical");
  });

  it("scores pod issues with restarts and status", () => {
    const low = buildPodProblemSignals({
      status: "Running",
      restarts: 0,
      cpuMillicores: 100,
      memoryBytes: 64 * 1024 * 1024,
    });
    const high = buildPodProblemSignals({
      status: "CrashLoopBackOff",
      restarts: 7,
      cpuMillicores: 1400,
      memoryBytes: 2 * 1024 * 1024 * 1024,
    });

    expect(high.score).toBeGreaterThan(low.score);
    expect(high.restartsSeverity).toBe("critical");
    expect(high.cpuSeverity).toBe("critical");
    expect(high.memorySeverity).toBe("critical");
  });

  it("scores node issues from conditions and usage", () => {
    const healthy = buildNodeProblemSignals({
      conditions: "Ready",
      cpu: "30%",
      memory: "42%",
      taints: 0,
    });
    const degraded = buildNodeProblemSignals({
      conditions: "NotReady,SchedulingDisabled",
      cpu: "97%",
      memory: "92%",
      taints: 2,
    });

    expect(degraded.score).toBeGreaterThan(healthy.score);
    expect(degraded.cpuSeverity).toBe("critical");
    expect(degraded.memorySeverity).toBe("warning");
  });

  it("scores controller workloads by readiness gaps", () => {
    const deploymentHealthy = buildDeploymentProblemScore({
      replicas: 3,
      ready: 3,
      upToDate: 3,
      available: 3,
      status: "🏃Running",
    });
    const deploymentDegraded = buildDeploymentProblemScore({
      replicas: 3,
      ready: 1,
      upToDate: 2,
      available: 1,
      status: "🕰️Pending",
    });
    expect(deploymentDegraded).toBeGreaterThan(deploymentHealthy);

    const daemonHealthy = buildDaemonSetProblemScore({
      desired: 5,
      ready: 5,
      updated: 5,
      available: 5,
    });
    const daemonDegraded = buildDaemonSetProblemScore({
      desired: 5,
      ready: 3,
      updated: 2,
      available: 3,
    });
    expect(daemonDegraded).toBeGreaterThan(daemonHealthy);

    const statefulHealthy = buildStatefulSetProblemScore({ replicas: 3, ready: 3 });
    const statefulDegraded = buildStatefulSetProblemScore({ replicas: 3, ready: 1 });
    expect(statefulDegraded).toBeGreaterThan(statefulHealthy);

    const replicaHealthy = buildReplicaSetProblemScore({
      desired: 4,
      current: 4,
      ready: 4,
    });
    const replicaDegraded = buildReplicaSetProblemScore({
      desired: 4,
      current: 3,
      ready: 2,
    });
    expect(replicaDegraded).toBeGreaterThan(replicaHealthy);
  });

  it("scores jobs and cron jobs by risk signals", () => {
    const jobHealthy = buildJobProblemScore({
      status: "Complete",
      succeeded: 2,
      completions: 2,
    });
    const jobDegraded = buildJobProblemScore({
      status: "Failed (BackoffLimitExceeded)",
      succeeded: 0,
      completions: 2,
    });
    expect(jobDegraded).toBeGreaterThan(jobHealthy);

    const cronHealthy = buildCronJobProblemScore({
      suspend: false,
      active: 0,
      hasLastSchedule: true,
    });
    const cronDegraded = buildCronJobProblemScore({
      suspend: false,
      active: 2,
      hasLastSchedule: false,
    });
    expect(cronDegraded).toBeGreaterThan(cronHealthy);
  });
});
