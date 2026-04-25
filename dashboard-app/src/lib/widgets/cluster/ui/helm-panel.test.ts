import { fireEvent, render, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HelmPanel from "./helm-panel.svelte";

vi.mock("$shared/api/helm", () => ({
  listHelmReleases: vi.fn(),
  listHelmRepos: vi.fn(),
  addHelmRepo: vi.fn(),
  removeHelmRepo: vi.fn(),
  installOrUpgradeHelmRelease: vi.fn(),
  uninstallHelmRelease: vi.fn(),
  getHelmReleaseStatus: vi.fn(),
  getHelmReleaseHistory: vi.fn(),
  getHelmReleaseValues: vi.fn(),
  getHelmReleaseManifest: vi.fn(),
  rollbackHelmRelease: vi.fn(),
  testHelmRelease: vi.fn(),
}));

vi.mock("$shared/lib/confirm-action", () => ({
  confirmAction: vi.fn(),
}));

import * as helmModule from "$shared/api/helm";
import * as confirmModule from "$shared/lib/confirm-action";
import { resetSectionEnterRefresh } from "$shared/lib/section-enter-refresh";

describe("helm-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSectionEnterRefresh();
    vi.mocked(confirmModule.confirmAction).mockResolvedValue(true);
    vi.mocked(helmModule.listHelmRepos).mockResolvedValue({
      repos: [{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }],
    });
    vi.mocked(helmModule.listHelmReleases).mockResolvedValue({
      releases: [
        {
          name: "nginx",
          namespace: "apps",
          chart: "bitnami/nginx-15.0.0",
          status: "deployed",
        },
      ],
    });
    vi.mocked(helmModule.addHelmRepo).mockResolvedValue({ success: true });
    vi.mocked(helmModule.removeHelmRepo).mockResolvedValue({ success: true });
    vi.mocked(helmModule.installOrUpgradeHelmRelease).mockResolvedValue({ success: true });
    vi.mocked(helmModule.uninstallHelmRelease).mockResolvedValue({ success: true });
    vi.mocked(helmModule.getHelmReleaseStatus).mockResolvedValue({
      status: { info: { status: "deployed" } },
    });
    vi.mocked(helmModule.getHelmReleaseHistory).mockResolvedValue({
      history: [{ revision: "1", status: "deployed", description: "install" }],
    });
    vi.mocked(helmModule.getHelmReleaseValues).mockResolvedValue({ values: "replicaCount: 2" });
    vi.mocked(helmModule.getHelmReleaseManifest).mockResolvedValue({
      manifest: "apiVersion: apps/v1",
    });
    vi.mocked(helmModule.rollbackHelmRelease).mockResolvedValue({ success: true });
    vi.mocked(helmModule.testHelmRelease).mockResolvedValue({ success: true, logs: "ok" });
  });

  it("loads releases and repositories", async () => {
    const { getByText } = render(HelmPanel, {
      props: { clusterId: "cluster-a" },
    });

    await waitFor(() => {
      expect(getByText("bitnami")).toBeInTheDocument();
      expect(getByText("nginx")).toBeInTheDocument();
    });
  });

  it("adds repository", async () => {
    const { getByLabelText, getByRole, getByText } = render(HelmPanel, {
      props: { clusterId: "cluster-a" },
    });

    await waitFor(() => expect(helmModule.listHelmRepos).toHaveBeenCalled());
    await fireEvent.input(getByLabelText("Repository name"), { target: { value: "grafana" } });
    await fireEvent.input(getByLabelText("Repository URL"), {
      target: { value: "https://grafana.github.io/helm-charts" },
    });
    await fireEvent.click(getByRole("button", { name: "Add repo" }));

    await waitFor(() => {
      expect(helmModule.addHelmRepo).toHaveBeenCalledWith(
        "grafana",
        "https://grafana.github.io/helm-charts",
      );
      expect(getByText("Action completed")).toBeInTheDocument();
    });
  });

  it("installs or upgrades release", async () => {
    const { getByLabelText, getByRole } = render(HelmPanel, {
      props: { clusterId: "cluster-a" },
    });

    await waitFor(() => expect(helmModule.listHelmReleases).toHaveBeenCalled());
    await fireEvent.input(getByLabelText("Release name"), { target: { value: "redis" } });
    await fireEvent.input(getByLabelText("Chart"), { target: { value: "bitnami/redis" } });
    await fireEvent.input(getByLabelText("Release namespace"), { target: { value: "cache" } });
    await fireEvent.click(getByRole("button", { name: "Install / upgrade" }));

    await waitFor(() => {
      expect(helmModule.installOrUpgradeHelmRelease).toHaveBeenCalledWith("cluster-a", {
        releaseName: "redis",
        chart: "bitnami/redis",
        namespace: "cache",
        createNamespace: true,
        onOutput: expect.any(Function),
      });
    });
  });

  it("uninstalls release from row action", async () => {
    const { getByText } = render(HelmPanel, {
      props: { clusterId: "cluster-a" },
    });

    const row = await waitFor(() => {
      const releaseRow = getByText("nginx").closest("tr");
      expect(releaseRow).not.toBeNull();
      return releaseRow as HTMLElement;
    });
    await fireEvent.click(within(row).getByRole("button", { name: "Uninstall" }));

    await waitFor(() => {
      expect(helmModule.uninstallHelmRelease).toHaveBeenCalledWith("cluster-a", {
        releaseName: "nginx",
        namespace: "apps",
        onOutput: expect.any(Function),
      });
      expect(confirmModule.confirmAction).toHaveBeenCalled();
    });
  });

  it("loads release status and rollbacks selected release", async () => {
    const { getByText, getByRole, getByLabelText } = render(HelmPanel, {
      props: { clusterId: "cluster-a" },
    });

    const row = await waitFor(() => {
      const releaseRow = getByText("nginx").closest("tr");
      expect(releaseRow).not.toBeNull();
      return releaseRow as HTMLElement;
    });

    await fireEvent.click(within(row).getByRole("button", { name: "Status" }));
    await waitFor(() => {
      expect(helmModule.getHelmReleaseStatus).toHaveBeenCalledWith("cluster-a", {
        releaseName: "nginx",
        namespace: "apps",
      });
    });

    await fireEvent.input(getByLabelText("Rollback revision"), { target: { value: "1" } });
    await fireEvent.click(getByRole("button", { name: "Rollback" }));
    await waitFor(() => {
      expect(helmModule.rollbackHelmRelease).toHaveBeenCalledWith("cluster-a", {
        releaseName: "nginx",
        namespace: "apps",
        revision: "1",
        onOutput: expect.any(Function),
      });
    });
  });
});
