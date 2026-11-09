import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  // Card 0gM0FvqM: the privacy notice promised the ID and its hash would be visible so a
  // user can quote the hash in a deletion request.
  it("shows the install ID and the hash PostHog stores, with copy buttons", async () => {
    window.localStorage.setItem("rozoom.install_id", "11111111-2222-4333-8444-555555555555");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const { getByTestId, getByLabelText, findByText } = render(FleetSettingsPanel);

    expect(getByTestId("install-id").textContent).toBe("11111111-2222-4333-8444-555555555555");
    // SHA-256 of the raw id, the same value wau-c reports as distinct_id.
    const expectedHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode("11111111-2222-4333-8444-555555555555"),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect((await findByText(expectedHash)).textContent).toBe(expectedHash);

    await fireEvent.click(getByLabelText("Copy install hash"));
    expect(writeText).toHaveBeenCalledWith(expectedHash);
    await fireEvent.click(getByLabelText("Copy install ID"));
    expect(writeText).toHaveBeenLastCalledWith("11111111-2222-4333-8444-555555555555");
  });
});
