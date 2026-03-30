import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import ClusterRuntimeTuningPanel from "./cluster-runtime-tuning-panel.svelte";
import {
  clusterRuntimeOverrides,
  resetClusterRuntimeContext,
  resolveClusterRuntimeBudgetForCluster,
  resolveClusterRuntimeState,
  setClusterRuntimeBudget,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";
import {
  getDashboardDataProfile,
  resolveClusterRuntimeBudget,
  setDashboardDataProfile,
} from "$shared/lib/dashboard-data-profile.svelte";

describe("cluster-runtime-tuning-panel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetClusterRuntimeContext();
    setDashboardDataProfile("balanced");
    setClusterRuntimeBudget(resolveClusterRuntimeBudget(getDashboardDataProfile()));
    setClusterRuntimeContext({
      activeClusterId: "cluster-a",
      diagnosticsEnabled: true,
      metricsEnabled: true,
    });
  });

  it("applies per-cluster overrides and can reset them", async () => {
    const { getByLabelText, getByRole, getByText } = render(ClusterRuntimeTuningPanel, {
      props: { clusterId: "cluster-a" },
    });

    await fireEvent.change(getByLabelText("Runtime state"), {
      currentTarget: { value: "offline" },
      target: { value: "offline" },
    });
    await fireEvent.change(getByLabelText("Network sensitivity"), {
      currentTarget: { value: "slow" },
      target: { value: "slow" },
    });

    const metricsCheckbox = getByLabelText("Metrics") as HTMLInputElement;
    await fireEvent.click(metricsCheckbox);

    const connectionsInput = getByLabelText("Max concurrent connections") as HTMLInputElement;
    connectionsInput.value = "3";
    await fireEvent.blur(connectionsInput);

    const refreshesInput = getByLabelText("Max concurrent cluster refreshes") as HTMLInputElement;
    refreshesInput.value = "2";
    await fireEvent.blur(refreshesInput);

    const diagnosticsInput = getByLabelText("Max concurrent diagnostics") as HTMLInputElement;
    diagnosticsInput.value = "1";
    await fireEvent.blur(diagnosticsInput);

    await fireEvent.change(getByLabelText("Metrics reads policy"), {
      currentTarget: { value: "reuse_only" },
      target: { value: "reuse_only" },
    });
    await fireEvent.change(getByLabelText("Capability discovery mode"), {
      currentTarget: { value: "lazy" },
      target: { value: "lazy" },
    });

    expect(resolveClusterRuntimeState("cluster-a")).toBe("offline");
    expect(resolveClusterRuntimeBudgetForCluster("cluster-a")).toEqual({
      maxActiveClusters: 2,
      maxWarmClusters: 4,
      maxConcurrentConnections: 3,
      maxConcurrentClusterRefreshes: 2,
      maxConcurrentDiagnostics: 1,
      maxConcurrentHeavyChecks: 4,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "slow",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    });
    expect(get(clusterRuntimeOverrides)["cluster-a"]).toEqual(
      expect.objectContaining({
        state: "offline",
        metricsEnabled: false,
        maxConcurrentConnections: 3,
        maxConcurrentClusterRefreshes: 2,
        maxConcurrentDiagnostics: 1,
        networkSensitivity: "slow",
        metricsReadPolicy: "reuse_only",
        capabilityDiscoveryMode: "lazy",
      }),
    );
    expect(getByText("Custom override active")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Reset override" }));

    expect(get(clusterRuntimeOverrides)).toEqual({});
    expect(resolveClusterRuntimeState("cluster-a")).toBe("active");
    expect(getByText("Inheriting shared profile")).toBeInTheDocument();
  });
});
