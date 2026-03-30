import { describe, expect, it } from "vitest";
import { buildAutoscalingPosture } from "./autoscaling-posture";

const workloads = [
  { name: "web", namespace: "prod", kind: "Deployment" },
  { name: "api", namespace: "prod", kind: "Deployment" },
  { name: "worker", namespace: "prod", kind: "Deployment" },
];

describe("autoscaling-posture", () => {
  it("builds posture from HPAs and VPAs", () => {
    const report = buildAutoscalingPosture(
      workloads,
      [
        {
          name: "web-hpa",
          namespace: "prod",
          targetRef: { kind: "Deployment", name: "web" },
          minReplicas: 2,
          maxReplicas: 10,
          currentReplicas: 3,
          desiredReplicas: 3,
          active: true,
        },
      ],
      [
        {
          name: "api-vpa",
          namespace: "prod",
          targetRef: { kind: "Deployment", name: "api" },
          mode: "Auto",
        },
      ],
      [],
      false,
      null,
    );

    expect(report.autoscalers).toHaveLength(2);
    expect(report.summary.total).toBe(2);
    expect(report.summary.active).toBe(2);
    expect(report.summary.coverage.hpaCount).toBe(1);
    expect(report.summary.coverage.vpaCount).toBe(1);
    expect(report.summary.coverage.workloadsWithAutoscaling).toBe(2);
    expect(report.summary.coverage.coveragePercent).toBe(67);
  });

  it("includes KEDA scaled objects", () => {
    const report = buildAutoscalingPosture(
      workloads,
      [],
      [],
      [
        {
          name: "worker-so",
          namespace: "prod",
          targetRef: { kind: "Deployment", name: "worker" },
          minReplicas: 0,
          maxReplicas: 50,
          active: true,
        },
      ],
      false,
      null,
    );

    expect(report.autoscalers).toHaveLength(1);
    expect(report.autoscalers[0]?.kind).toBe("keda");
    expect(report.summary.coverage.kedaCount).toBe(1);
  });

  it("detects cluster autoscaler", () => {
    const report = buildAutoscalingPosture(workloads, [], [], [], true, "karpenter");

    expect(report.clusterAutoscaling.detected).toBe(true);
    expect(report.clusterAutoscaling.kind).toBe("karpenter");
  });

  it("reports 0% coverage with no autoscalers", () => {
    const report = buildAutoscalingPosture(workloads, [], [], [], false, null);

    expect(report.summary.coverage.coveragePercent).toBe(0);
    expect(report.autoscalers).toHaveLength(0);
  });

  it("handles empty workloads", () => {
    const report = buildAutoscalingPosture([], [], [], [], false, null);

    expect(report.summary.coverage.coveragePercent).toBe(0);
    expect(report.summary.coverage.totalWorkloads).toBe(0);
  });

  it("tracks issues in HPAs", () => {
    const report = buildAutoscalingPosture(
      workloads,
      [{ name: "broken-hpa", namespace: "prod", active: false, issues: ["ScalingActive=False"] }],
      [],
      [],
      false,
      null,
    );

    expect(report.summary.inactive).toBe(1);
    expect(report.summary.withIssues).toBe(1);
  });
});
