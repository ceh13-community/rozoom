import { beforeEach, describe, expect, it, vi } from "vitest";
import { installKubeArmor, listHelmReleases } from "$shared/api/helm";
import { armorHubState, installArmorProvider, runArmorHubScan } from "./store";

vi.mock("$shared/api/helm", () => ({
  listHelmReleases: vi.fn(),
  installKubeArmor: vi.fn(),
}));

vi.mock("$features/check-health/model/cache-store", () => ({
  updateClusterCheckPartially: vi.fn(),
}));

import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";

describe("armor hub store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armorHubState.set({});
  });

  it("detects kubearmor from helm releases", async () => {
    vi.mocked(listHelmReleases).mockResolvedValue({
      releases: [
        { name: "kubearmor-operator", namespace: "kubearmor", chart: "kubearmor/kubearmor-1.5.0" },
      ],
    });

    const state = await runArmorHubScan("cluster-a", { force: true });

    expect(state.summary.status).toBe("ok");
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.id).toBe("kubearmor");
    expect(state.providers.filter((provider) => provider.status === "installed")).toHaveLength(1);
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(
      "cluster-a",
      expect.objectContaining({
        armorSummary: expect.objectContaining({
          status: "ok",
        }),
      }),
    );
  });

  it("delegates install for kubearmor", async () => {
    vi.mocked(installKubeArmor).mockResolvedValue({ success: true });
    const result = await installArmorProvider("cluster-a", "kubearmor");
    expect(result.success).toBe(true);
    expect(installKubeArmor).toHaveBeenCalledWith("cluster-a");
  });
});
