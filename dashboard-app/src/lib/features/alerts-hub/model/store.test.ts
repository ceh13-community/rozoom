import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { checkWarningEvents } from "$features/check-health";
import { getPrometheusStackRelease } from "$shared/api/helm";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  resetClusterRuntimeContext,
  setClusterRuntimeBudget,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";
import { alertHubState, runAlertHubScan, startAlertHubPolling, stopAlertHubPolling } from "./store";

vi.mock("$features/check-health", () => ({
  checkWarningEvents: vi.fn(),
}));

vi.mock("$shared/api/helm", () => ({
  getPrometheusStackRelease: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("$features/check-health/model/cache-store", () => ({
  updateClusterCheckPartially: vi.fn(),
}));

import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";

describe("alerts hub store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetClusterRuntimeContext();
    alertHubState.set({});
  });

  it("loads alerts from Alertmanager when monitoring stack is installed", async () => {
    vi.mocked(getPrometheusStackRelease).mockResolvedValueOnce({
      installed: true,
      release: {
        name: "kube-prometheus-stack",
        namespace: "monitoring",
        chart: "prometheus-community/kube-prometheus-stack-61.7.2",
      },
    });
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      code: 0,
      errors: "",
      output: JSON.stringify([
        {
          fingerprint: "fp-1",
          status: { state: "active", silencedBy: [], inhibitedBy: [] },
          labels: { alertname: "KubePodCrashLooping", severity: "warning", namespace: "default" },
          annotations: { summary: "Pod is crashlooping", description: "restart loop detected" },
          startsAt: "2026-02-17T10:00:00Z",
          receivers: [{ name: "slack-default" }],
        },
      ]),
    });

    const state = await runAlertHubScan("cluster-a", { force: true });

    expect(state.summary.source).toBe("alertmanager");
    expect(state.summary.status).toBe("degraded");
    expect(state.summary.alertmanagerLastSuccessAt).not.toBeNull();
    expect(state.summary.alertmanagerLastError).toBeNull();
    expect(state.alerts[0].alertname).toBe("KubePodCrashLooping");
    expect(state.alerts[0].severity).toBe("warn");
    expect(checkWarningEvents).not.toHaveBeenCalled();
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(
      "cluster-a",
      expect.objectContaining({
        alertsSummary: expect.objectContaining({
          status: "degraded",
          message: expect.stringContaining("active alert"),
          activeCount: 1,
          source: "alertmanager",
        }),
      }),
    );
  });

  it("falls back to Kubernetes warning events when Alertmanager is unavailable", async () => {
    vi.mocked(getPrometheusStackRelease).mockResolvedValueOnce({
      installed: false,
    });
    vi.mocked(checkWarningEvents).mockResolvedValueOnce({
      status: "warning",
      summary: {
        status: "warning",
        message: "Warnings last 30m: 1",
        warnings: [],
        updatedAt: Date.now(),
      },
      items: [
        {
          timestamp: Date.parse("2026-02-17T10:00:00Z"),
          type: "Warning",
          namespace: "default",
          objectKind: "Pod",
          objectName: "api-0",
          reason: "BackOff",
          message: "Back-off restarting failed container",
          count: 3,
        },
      ],
      errors: undefined,
      updatedAt: Date.now(),
    });

    const state = await runAlertHubScan("cluster-a", { force: true });
    const stored = get(alertHubState)["cluster-a"];

    expect(state.summary.source).toBe("events");
    expect(state.summary.status).toBe("degraded");
    expect(state.summary.alertmanagerLastSuccessAt).toBeNull();
    expect(state.summary.alertmanagerLastError).toContain("Prometheus stack is not installed");
    expect(state.alerts.length).toBe(1);
    expect(state.errors?.[0]).toContain("Alertmanager unavailable");
    expect(stored?.alerts.length).toBe(1);
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(
      "cluster-a",
      expect.objectContaining({
        alertsSummary: expect.objectContaining({
          status: "degraded",
          activeCount: 1,
          source: "events",
        }),
      }),
    );
  });

  it("keeps last successful Alertmanager fetch time after fallback to events", async () => {
    vi.mocked(getPrometheusStackRelease)
      .mockResolvedValueOnce({
        installed: true,
        release: {
          name: "kube-prometheus-stack",
          namespace: "monitoring",
          chart: "prometheus-community/kube-prometheus-stack-61.7.2",
        },
      })
      .mockResolvedValueOnce({
        installed: false,
      });
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      code: 0,
      errors: "",
      output: JSON.stringify([
        {
          fingerprint: "fp-1",
          status: { state: "active", silencedBy: [], inhibitedBy: [] },
          labels: { alertname: "Watchdog", severity: "info" },
          annotations: { summary: "Always firing", description: "Pipeline check" },
          startsAt: "2026-02-17T11:00:00Z",
        },
      ]),
    });
    vi.mocked(checkWarningEvents).mockResolvedValue({
      status: "warning",
      summary: {
        status: "warning",
        message: "Warnings last 30m: 1",
        warnings: [],
        updatedAt: Date.now(),
      },
      items: [
        {
          timestamp: Date.parse("2026-02-17T11:05:00Z"),
          type: "Warning",
          namespace: "default",
          objectKind: "Pod",
          objectName: "api-0",
          reason: "BackOff",
          message: "Back-off restarting failed container",
          count: 1,
        },
      ],
      errors: undefined,
      updatedAt: Date.now(),
    });

    const first = await runAlertHubScan("cluster-a", { force: true });
    const second = await runAlertHubScan("cluster-a", { force: true });

    expect(first.summary.alertmanagerLastSuccessAt).not.toBeNull();
    expect(second.summary.source).toBe("events");
    expect(second.summary.alertmanagerLastSuccessAt).toBe(first.summary.alertmanagerLastSuccessAt);
    expect(second.summary.alertmanagerLastError).toContain("Prometheus stack is not installed");
  });

  it("marks feed unavailable when scan throws unexpected error", async () => {
    vi.mocked(getPrometheusStackRelease).mockRejectedValueOnce(new Error("helm unavailable"));

    const state = await runAlertHubScan("cluster-a", { force: true });

    expect(state.summary.status).toBe("unavailable");
    expect(state.summary.source).toBe("none");
    expect(state.summary.message).toContain("helm unavailable");
    expect(state.errors?.[0]).toContain("helm unavailable");
  });

  it("dedupes alerts by fingerprint so keyed #each blocks do not crash", async () => {
    vi.mocked(getPrometheusStackRelease).mockResolvedValueOnce({
      installed: true,
      release: {
        name: "kps",
        namespace: "kps",
        chart: "prometheus-community/kube-prometheus-stack-61.7.2",
      },
    });
    // Alertmanager really does return the same fingerprint twice when a
    // rule routes through multiple receivers. Before the fix, both
    // AlertItems landed with the same id and Svelte crashed with
    // each_key_duplicate on the panel's keyed each block.
    vi.mocked(kubectlRawArgsFront).mockResolvedValueOnce({
      code: 0,
      errors: "",
      output: JSON.stringify([
        {
          fingerprint: "kps/AlertmanagerClusterFailedToSendAlerts",
          status: { state: "active", silencedBy: [], inhibitedBy: [] },
          labels: { alertname: "AlertmanagerClusterFailedToSendAlerts", severity: "warning" },
          annotations: {},
          startsAt: "2026-02-17T10:00:00Z",
          receivers: [{ name: "slack-default" }],
        },
        {
          fingerprint: "kps/AlertmanagerClusterFailedToSendAlerts",
          status: { state: "active", silencedBy: [], inhibitedBy: [] },
          labels: { alertname: "AlertmanagerClusterFailedToSendAlerts", severity: "critical" },
          annotations: {},
          startsAt: "2026-02-17T10:00:00Z",
          receivers: [{ name: "pager" }],
        },
      ]),
    });

    const state = await runAlertHubScan("cluster-a", { force: true });

    expect(state.alerts.length).toBe(2);
    expect(state.alerts[0].id).toBe("kps/AlertmanagerClusterFailedToSendAlerts");
    expect(state.alerts[1].id).toBe("kps/AlertmanagerClusterFailedToSendAlerts#1");
    expect(new Set(state.alerts.map((a) => a.id)).size).toBe(state.alerts.length);
  });

  it("suspends heavy polling when runtime budget disables heavy diagnostics", async () => {
    vi.mocked(getPrometheusStackRelease).mockResolvedValue({
      installed: false,
    });
    vi.mocked(checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: {
        status: "ok",
        message: "No warnings",
        warnings: [],
        updatedAt: Date.now(),
      },
      items: [],
      errors: undefined,
      updatedAt: Date.now(),
    });

    setClusterRuntimeContext({ activeClusterId: "cluster-a", diagnosticsEnabled: true });
    setClusterRuntimeBudget({ maxConcurrentHeavyChecks: 0 });

    startAlertHubPolling("cluster-a");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checkWarningEvents).not.toHaveBeenCalled();

    setClusterRuntimeBudget({ maxConcurrentHeavyChecks: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(checkWarningEvents).toHaveBeenCalledTimes(1);

    stopAlertHubPolling("cluster-a");
  });
});
