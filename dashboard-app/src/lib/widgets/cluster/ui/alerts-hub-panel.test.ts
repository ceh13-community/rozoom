import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$features/alerts-hub", async () => {
  const { writable } = await import("svelte/store");
  return {
    alertHubConfig: writable({ cacheTtlMs: 30_000, scheduleMs: 15_000 }),
    alertHubState: writable({}),
    createSilence: vi.fn(),
    markAlertHubUnavailable: vi.fn(),
    runAlertHubScan: vi.fn(),
    startAlertHubPolling: vi.fn(),
    stopAlertHubPolling: vi.fn(),
  };
});

vi.mock("$shared/api/helm", () => ({
  getPrometheusStackRelease: vi.fn(),
  installPrometheusStack: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import * as alertHubModule from "$features/alerts-hub";
import * as helmModule from "$shared/api/helm";
import * as kubectlModule from "$shared/api/kubectl-proxy";
import AlertsHubPanel from "./alerts-hub-panel.svelte";

describe("alerts-hub-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alertHubModule.alertHubState.set({
      "cluster-a": {
        summary: {
          status: "ok",
          lastRunAt: "2026-02-22T12:00:00Z",
          source: "alertmanager",
          message: "1 alert loaded",
          alertmanagerLastSuccessAt: "2026-02-22T12:00:00Z",
          alertmanagerLastError: null,
        },
        alerts: [],
        errors: [],
      },
    });
    vi.mocked(alertHubModule.runAlertHubScan).mockResolvedValue({} as never);
    vi.mocked(helmModule.getPrometheusStackRelease).mockResolvedValue({
      installed: true,
      release: {
        name: "kube-prometheus-stack",
        namespace: "monitoring",
        chart: "kube-prometheus-stack-82.1.0",
      },
    });
    vi.mocked(kubectlModule.kubectlRawFront).mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: { name: "kube-prometheus-stack-prometheus-0" },
            status: {
              phase: "Running",
              conditions: [{ type: "Ready", status: "True" }],
              containerStatuses: [{ ready: true }],
            },
          },
          {
            metadata: { name: "alertmanager-kube-prometheus-stack-alertmanager-0" },
            status: {
              phase: "Running",
              conditions: [{ type: "Ready", status: "True" }],
              containerStatuses: [{ ready: true }],
            },
          },
        ],
      }),
      errors: "",
      code: 0,
    });
    vi.mocked(helmModule.installPrometheusStack).mockResolvedValue({ success: true });
  });

  it("refreshes alerts on button click", async () => {
    const { getAllByRole } = render(AlertsHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    const refreshButton = getAllByRole("button", { name: /Refresh status/i }).find(
      (button) => !button.hasAttribute("disabled"),
    );
    expect(refreshButton).toBeDefined();
    await fireEvent.click(refreshButton!);

    await waitFor(() => {
      expect(alertHubModule.runAlertHubScan).toHaveBeenCalledWith("cluster-a", { force: true });
    });
  });

  it("clears refreshing state even when refresh fails", async () => {
    let rejectRefresh: (error: Error) => void = () => {};
    vi.mocked(alertHubModule.runAlertHubScan).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRefresh = reject;
        }) as never,
    );

    const { getAllByRole } = render(AlertsHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    const refreshButton = getAllByRole("button", { name: /Refresh status/i }).find(
      (button) => !button.hasAttribute("disabled"),
    );
    expect(refreshButton).toBeDefined();
    await fireEvent.click(refreshButton!);

    await waitFor(() => {
      expect(refreshButton!).toBeDisabled();
    });

    rejectRefresh(new Error("refresh failed"));

    await waitFor(() => {
      expect(refreshButton!).not.toBeDisabled();
    });
  });
});
