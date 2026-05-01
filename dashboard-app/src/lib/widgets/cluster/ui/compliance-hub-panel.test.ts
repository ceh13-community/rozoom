import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$features/compliance-hub", async () => {
  const { writable } = await import("svelte/store");
  return {
    complianceHubConfig: writable({ cacheTtlMs: 30_000, scheduleMs: 30_000 }),
    complianceHubState: writable({}),
    runComplianceHubScan: vi.fn(),
    runKubescapeScanNow: vi.fn(),
    runKubeBenchScanNow: vi.fn(),
    fetchLatestKubeBenchLogs: vi.fn(),
    startComplianceHubPolling: vi.fn(),
    stopComplianceHubPolling: vi.fn(),
    markComplianceHubUnavailable: vi.fn(),
    installComplianceProvider: vi.fn(),
  };
});

import * as complianceHubModule from "$features/compliance-hub";
import ComplianceHubPanel from "./compliance-hub-panel.svelte";

describe("compliance-hub-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    complianceHubModule.complianceHubState.set({
      "cluster-a": {
        summary: {
          status: "degraded",
          lastRunAt: "2026-02-17T22:00:00Z",
          message: "Compliance needs attention",
        },
        providers: [
          {
            id: "kubescape",
            title: "Kubescape",
            status: "not_installed",
            message: "Not installed",
          },
          {
            id: "kube-bench",
            title: "kube-bench",
            status: "not_installed",
            message: "",
          },
        ],
        findings: [],
      },
    });
    vi.mocked(complianceHubModule.runComplianceHubScan).mockResolvedValue({} as never);
    vi.mocked(complianceHubModule.runKubescapeScanNow).mockResolvedValue({ success: true });
    vi.mocked(complianceHubModule.runKubeBenchScanNow).mockResolvedValue({ success: true });
    vi.mocked(complianceHubModule.fetchLatestKubeBenchLogs).mockResolvedValue({
      success: false,
      error: "No kube-bench jobs found yet.",
    });
    vi.mocked(complianceHubModule.installComplianceProvider).mockResolvedValue({ success: true });
  });

  it("renders provider and installs it via helm", async () => {
    const { getByRole, getAllByText, getByText } = render(ComplianceHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    expect(getByText("Compliance Hub")).toBeInTheDocument();
    expect(getAllByText("Kubescape").length).toBeGreaterThan(0);

    await fireEvent.click(getByRole("button", { name: "Install (Helm)" }));

    await waitFor(() => {
      expect(complianceHubModule.installComplianceProvider).toHaveBeenCalledWith(
        "cluster-a",
        "kubescape",
        expect.any(Function),
      );
    });
    expect(getByText("Action completed")).toBeInTheDocument();
  });

  it("shows last scan time from summary even when findings are empty", () => {
    const { getByText } = render(ComplianceHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    const lastScanLabel = getByText("Last scan");
    const card = lastScanLabel.closest("div")?.parentElement;
    expect(card).toHaveTextContent(/2026|2\/17\/2026|17\.02\.2026/);
  });

  it("keeps kube-bench logs action enabled in manual job mode", () => {
    const { getByRole } = render(ComplianceHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    const button = getByRole("button", { name: "View latest kube-bench logs" });
    expect(button).toBeEnabled();
  });
});
