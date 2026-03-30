import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawFrontMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

function makePodItem(
  name: string,
  namespace: string,
  phase: string,
  opts: {
    restartCount?: number;
    crashLoop?: boolean;
    creationTimestamp?: string;
    waitingReason?: string;
  } = {},
) {
  return {
    metadata: {
      name,
      namespace,
      creationTimestamp: opts.creationTimestamp ?? new Date().toISOString(),
    },
    status: {
      phase,
      containerStatuses: [
        {
          restartCount: opts.restartCount ?? 0,
          state: {
            waiting: opts.crashLoop
              ? { reason: "CrashLoopBackOff", message: "back-off restarting" }
              : opts.waitingReason
                ? { reason: opts.waitingReason }
                : undefined,
          },
          lastState: {},
        },
      ],
    },
    spec: { containers: [] },
  };
}

describe("check-pod-issues", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    kubectlRawFrontMock.mockReset();
    logErrorMock.mockReset();
  });

  it("returns ok when no pod issues exist", async () => {
    const pods = [makePodItem("healthy-1", "default", "Running")];

    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-1", { force: true, pods: pods as never[] });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(0);
    expect(report.crashLoopCount).toBe(0);
    expect(report.pendingCount).toBe(0);
    expect(report.totalPods).toBe(1);
  });

  it("detects CrashLoopBackOff pods", async () => {
    const pods = [
      makePodItem("crash-pod", "default", "Running", { crashLoop: true, restartCount: 10 }),
      makePodItem("healthy-pod", "default", "Running"),
    ];

    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-2", { force: true, pods: pods as never[] });

    expect(report.status).toBe("critical");
    expect(report.crashLoopCount).toBe(1);
    expect(report.items[0].type).toBe("crashloop");
    expect(report.items[0].pod).toBe("crash-pod");
  });

  it("detects long-pending pods", async () => {
    const oldTimestamp = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const pods = [
      makePodItem("pending-pod", "default", "Pending", { creationTimestamp: oldTimestamp }),
      // Add enough healthy pods so the ratio stays below the critical threshold (10%)
      ...Array.from({ length: 20 }, (_, i) => makePodItem(`healthy-${i}`, "default", "Running")),
    ];

    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-3", { force: true, pods: pods as never[] });

    expect(report.status).toBe("warning");
    expect(report.pendingCount).toBe(1);
    expect(report.items[0].type).toBe("pending");
  });

  it("returns ok when pods list is empty", async () => {
    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-4", { force: true, pods: [] as never[] });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(0);
    expect(report.totalPods).toBe(0);
  });

  it("handles kubectl error response gracefully", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-5", { force: true });

    expect(report.status).toBe("unknown");
    expect(report.errors).toBeTruthy();
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles thrown errors gracefully", async () => {
    kubectlRawFrontMock.mockRejectedValueOnce(new Error("network error"));

    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-6", { force: true });

    expect(report.status).toBe("unknown");
    expect(report.errors).toContain("network error");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("parses raw kubectl JSON output for crashloop pods", async () => {
    const rawPods = {
      items: [
        {
          metadata: {
            name: "raw-crash",
            namespace: "default",
            creationTimestamp: new Date().toISOString(),
          },
          status: {
            phase: "Running",
            containerStatuses: [
              {
                restartCount: 10,
                state: { waiting: { reason: "CrashLoopBackOff", message: "crash" } },
              },
            ],
          },
        },
      ],
    };

    kubectlRawFrontMock.mockResolvedValueOnce({
      output: JSON.stringify(rawPods),
      errors: "",
      code: 0,
    });

    const { checkPodIssues } = await import("./check-pod-issues");
    const report = await checkPodIssues("cluster-7", { force: true });

    expect(report.status).toBe("critical");
    expect(report.crashLoopCount).toBe(1);
  });

  it("uses cache within 60s", async () => {
    const pods = [makePodItem("pod-1", "default", "Running")];

    const { checkPodIssues } = await import("./check-pod-issues");
    await checkPodIssues("cluster-8", { pods: pods as never[] });
    await checkPodIssues("cluster-8");

    expect(kubectlRawFrontMock).not.toHaveBeenCalled();
  });
});
