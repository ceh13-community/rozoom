import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$features/trivy-hub", async () => {
  const { writable } = await import("svelte/store");
  return {
    installTrivyProvider: vi.fn(),
    markTrivyHubUnavailable: vi.fn(),
    runTrivyHubScan: vi.fn(),
    runTrivyScanNow: vi.fn(),
    setTrivyHubReport: vi.fn(),
    trivyHubConfig: writable({ cacheTtlMs: 30_000, scheduleMs: 30_000 }),
    trivyHubReports: writable({}),
    trivyHubState: writable({}),
  };
});

import * as trivyHubModule from "$features/trivy-hub";
import TrivyHubPanel from "./trivy-hub-panel.svelte";

describe("trivy-hub-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trivyHubModule.trivyHubState.set({
      "cluster-a": {
        summary: {
          status: "ok",
          lastRunAt: "2026-02-18T00:00:00Z",
          message: "Trivy Operator is detected",
        },
        providers: [
          {
            id: "trivy-operator",
            title: "Trivy Operator",
            status: "installed",
            namespace: "trivy-system",
            releaseName: "trivy-operator",
            chartVersion: "0.22.0",
            message: "Installed in trivy-system namespace",
            docsUrl: "https://aquasecurity.github.io/trivy-operator/",
            githubUrl: "https://github.com/aquasecurity/trivy-operator",
          },
        ],
      },
    });
    trivyHubModule.trivyHubReports.set({});
    vi.mocked(trivyHubModule.runTrivyHubScan).mockResolvedValue({} as never);
    vi.mocked(trivyHubModule.installTrivyProvider).mockResolvedValue({ success: true });
    vi.mocked(trivyHubModule.runTrivyScanNow).mockResolvedValue({ success: true, report: {} });
  });

  it("renders panel and refreshes", async () => {
    const { getByRole, getByText } = render(TrivyHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    expect(getByRole("heading", { name: "Trivy" })).toBeInTheDocument();
    expect(getByText("Installed in trivy-system namespace")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: /Refresh status/i }));

    await waitFor(() => {
      expect(trivyHubModule.runTrivyHubScan).toHaveBeenCalledWith("cluster-a", {
        force: true,
        statusOnly: true,
      });
    });
  });

  it("installs missing provider", async () => {
    trivyHubModule.trivyHubState.set({
      "cluster-a": {
        summary: {
          status: "unavailable",
          lastRunAt: "2026-02-18T00:00:00Z",
          message: "Trivy Operator is not detected",
        },
        providers: [
          {
            id: "trivy-operator",
            title: "Trivy Operator",
            status: "not_installed",
            message: "",
            docsUrl: "https://aquasecurity.github.io/trivy-operator/",
            githubUrl: "https://github.com/aquasecurity/trivy-operator",
          },
        ],
      },
    });

    const { getByRole } = render(TrivyHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    await fireEvent.click(getByRole("button", { name: "Install (Helm)" }));

    await waitFor(() => {
      expect(trivyHubModule.installTrivyProvider).toHaveBeenCalledWith(
        "cluster-a",
        "trivy-operator",
        expect.any(Function),
      );
      expect(trivyHubModule.runTrivyHubScan).toHaveBeenNthCalledWith(1, "cluster-a", {
        force: false,
        statusOnly: true,
      });
      expect(trivyHubModule.runTrivyHubScan).toHaveBeenNthCalledWith(2, "cluster-a", {
        force: true,
      });
    });
  });

  it("runs trivy scan", async () => {
    const { getByRole } = render(TrivyHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    await fireEvent.click(getByRole("button", { name: "Run Trivy scan" }));

    await waitFor(() => {
      expect(trivyHubModule.runTrivyScanNow).toHaveBeenCalledWith("cluster-a");
    });
  });
});
