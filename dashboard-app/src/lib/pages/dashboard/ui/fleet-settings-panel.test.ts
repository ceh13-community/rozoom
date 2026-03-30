import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import FleetSettingsPanel from "./fleet-settings-panel.svelte";
import {
  clearDashboardRuntimeControlPlane,
  getDashboardDataProfile,
  getDashboardRuntimeControlPlane,
  setDashboardDataProfile,
} from "$shared/lib/dashboard-data-profile.svelte";

describe("fleet-settings-panel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearDashboardRuntimeControlPlane();
    setDashboardDataProfile("balanced");
  });

  it("updates the shared profile and persisted global runtime overrides", async () => {
    const { getByLabelText, getByRole, getByText } = render(FleetSettingsPanel);

    await fireEvent.change(getByLabelText("Dashboard profile"), {
      currentTarget: { value: "fleet" },
      target: { value: "fleet" },
    });

    const warmInput = getByLabelText("Max warm clusters") as HTMLInputElement;
    warmInput.value = "5";
    await fireEvent.blur(warmInput);

    const refreshInput = getByLabelText("Max concurrent cluster refreshes") as HTMLInputElement;
    refreshInput.value = "2";
    await fireEvent.blur(refreshInput);

    const diagnosticsInput = getByLabelText("Max concurrent diagnostics") as HTMLInputElement;
    diagnosticsInput.value = "1";
    await fireEvent.blur(diagnosticsInput);

    await fireEvent.change(getByLabelText("Global metrics reads policy"), {
      currentTarget: { value: "reuse_only" },
      target: { value: "reuse_only" },
    });
    await fireEvent.change(getByLabelText("Global capability discovery mode"), {
      currentTarget: { value: "lazy" },
      target: { value: "lazy" },
    });

    const metricsCheckbox = getByLabelText("Global metrics") as HTMLInputElement;
    await fireEvent.click(metricsCheckbox);

    expect(getDashboardDataProfile().id).toBe("fleet");
    expect(getDashboardRuntimeControlPlane()).toEqual(
      expect.objectContaining({
        maxWarmClusters: 5,
        maxConcurrentClusterRefreshes: 2,
        maxConcurrentDiagnostics: 1,
        metricsReadPolicy: "reuse_only",
        capabilityDiscoveryMode: "lazy",
        metricsEnabled: true,
      }),
    );
    expect(
      getByText("Global overrides are active on top of the shared profile."),
    ).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Reset global overrides" }));
    expect(getDashboardRuntimeControlPlane()).toEqual({});
  });
});
