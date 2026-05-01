import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$features/armor-hub", async () => {
  const { writable } = await import("svelte/store");
  return {
    armorHubConfig: writable({ cacheTtlMs: 30_000, scheduleMs: 30_000 }),
    armorHubReports: writable({}),
    armorHubState: writable({}),
    installArmorProvider: vi.fn(),
    runArmorScanNow: vi.fn(),
    runArmorHubScan: vi.fn(),
    startArmorHubPolling: vi.fn(),
    stopArmorHubPolling: vi.fn(),
    markArmorHubUnavailable: vi.fn(),
  };
});

import * as armorHubModule from "$features/armor-hub";
import ArmorHubPanel from "./armor-hub-panel.svelte";

describe("armor-hub-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armorHubModule.armorHubReports.set({});
    armorHubModule.armorHubState.set({
      "cluster-a": {
        summary: {
          status: "ok",
          lastRunAt: "2026-02-18T00:00:00Z",
          message: "KubeArmor is detected",
        },
        providers: [
          {
            id: "kubearmor",
            title: "KubeArmor",
            status: "installed",
            namespace: "kubearmor",
            releaseName: "kubearmor-operator",
            chartVersion: "1.5.0",
            message: "Installed in kubearmor namespace",
            docsUrl: "https://docs.kubearmor.io/",
            githubUrl: "https://github.com/kubearmor/KubeArmor",
          },
        ],
      },
    });
    vi.mocked(armorHubModule.runArmorHubScan).mockResolvedValue({} as never);
    vi.mocked(armorHubModule.installArmorProvider).mockResolvedValue({ success: true });
    vi.mocked(armorHubModule.runArmorScanNow).mockResolvedValue({ success: true, report: {} });
  });

  it("renders panel and refreshes", async () => {
    const { getByRole, getByText } = render(ArmorHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    expect(getByRole("heading", { name: "KubeArmor" })).toBeInTheDocument();
    expect(getByText("Installed in kubearmor namespace")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: /Refresh status/i }));

    await waitFor(() => {
      expect(armorHubModule.runArmorHubScan).toHaveBeenCalledWith("cluster-a", {
        force: true,
        statusOnly: true,
      });
    });
  });

  it("installs missing provider", async () => {
    armorHubModule.armorHubState.set({
      "cluster-a": {
        summary: {
          status: "unavailable",
          lastRunAt: "2026-02-18T00:00:00Z",
          message: "not detected",
        },
        providers: [
          {
            id: "kubearmor",
            title: "KubeArmor",
            status: "not_installed",
            message: "",
            docsUrl: "https://docs.kubearmor.io/",
            githubUrl: "https://github.com/kubearmor/KubeArmor",
          },
        ],
      },
    });

    const { getByRole } = render(ArmorHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    await fireEvent.click(getByRole("button", { name: "Install (Helm)" }));

    await waitFor(() => {
      expect(armorHubModule.installArmorProvider).toHaveBeenCalledWith(
        "cluster-a",
        "kubearmor",
        expect.any(Function),
      );
      expect(armorHubModule.runArmorHubScan).toHaveBeenNthCalledWith(1, "cluster-a", {
        force: false,
        statusOnly: true,
      });
      expect(armorHubModule.runArmorHubScan).toHaveBeenNthCalledWith(2, "cluster-a", {
        force: true,
      });
    });
  });

  it("runs armor scan", async () => {
    const { getByRole } = render(ArmorHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    await fireEvent.click(getByRole("button", { name: "Run armor scan" }));

    await waitFor(() => {
      expect(armorHubModule.runArmorScanNow).toHaveBeenCalledWith("cluster-a");
    });
  });

  it("keeps previously saved report visible on Report tab", async () => {
    armorHubModule.armorHubReports.set({
      "cluster-a": JSON.stringify(
        { generatedAt: "2026-02-18T00:00:00Z", summary: { providersInstalled: 1 } },
        null,
        2,
      ),
    });

    const { getByText, getByRole } = render(ArmorHubPanel, {
      props: { clusterId: "cluster-a" },
    });

    await fireEvent.click(getByRole("button", { name: /^Report$/ }));

    await waitFor(() => {
      expect(getByText("Latest armor scan report")).toBeInTheDocument();
    });
  });
});
