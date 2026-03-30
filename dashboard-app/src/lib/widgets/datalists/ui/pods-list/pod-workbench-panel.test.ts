import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDashboardDataProfile } from "$shared/lib/dashboard-data-profile.svelte";
import PodWorkbenchPanel from "./pod-workbench-panel.svelte";
import { getPodsWorkbenchStateKey } from "./workbench-session";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(async (args: string[]) => {
    if (args.includes("yaml")) {
      return {
        output: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: api-0\n",
        errors: "",
        code: 0,
      };
    }
    return { output: "line-1\nline-2\n", errors: "", code: 0 };
  }),
  kubectlStreamArgsFront: vi.fn(async () => ({
    child: {},
    stop: async () => undefined,
  })),
}));

vi.mock("$features/pod-details", () => ({
  loadPodEvents: vi.fn(async () => [
    {
      reason: "BackOff",
      type: "Warning",
      lastTimestamp: "2026-03-08T10:00:00Z",
      source: "kubelet",
      count: 1,
      message: "Back-off restarting failed container",
    },
  ]),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setDashboardDataProfile("balanced");
  vi.restoreAllMocks();
});

describe("PodWorkbenchPanel", () => {
  it("opens a logs tab from an external request while keeping workbench state separate", async () => {
    const { getAllByText, getByText } = render(PodWorkbenchPanel, {
      props: {
        clusterId: "cluster-1",
        podsByUid: new Map([
          [
            "uid-1",
            {
              metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
              spec: { containers: [{ name: "api" }] },
            } as unknown as import("$shared/model/clusters").PodItem,
          ],
        ]),
        metricsByKey: new Map([
          [
            "prod/api-0",
            { cpu: "12m", memory: "48Mi", cpuMillicores: 12, memoryBytes: 48 * 1024 * 1024 },
          ],
        ]),
        metricsError: null,
        request: {
          token: 1,
          kind: "logs",
          podUid: "uid-1",
        },
      },
    });

    await waitFor(() => {
      expect(getByText("Reopen")).toBeInTheDocument();
    });

    expect(getByText("Pane 1")).toBeInTheDocument();
    expect(getAllByText("api-0").length).toBeGreaterThan(0);
    expect(getByText("Pod logs: prod/api-0")).toBeInTheDocument();
    expect(getByText("Pod logs: prod/api-0")).toBeInTheDocument();
    // Metrics now shown via ResourceMetricsBadge component (polls kubectl top)
  });

  it("restores balanced pane state after switching through realtime mode", async () => {
    setDashboardDataProfile("balanced");
    window.localStorage.setItem(
      getPodsWorkbenchStateKey("cluster-1", "balanced"),
      JSON.stringify({
        version: 1,
        tabs: [
          { kind: "logs", name: "api-0", namespace: "prod", pinned: false },
          { kind: "yaml", name: "api-0", namespace: "prod", pinned: false },
        ],
        activeTabId: "logs:prod/api-0",
        layout: "dual",
        paneTabIds: ["logs:prod/api-0", "yaml:prod/api-0", null],
        collapsedPaneIndexes: [1],
        closedTabs: [],
        workbenchCollapsed: true,
        workbenchFullscreen: false,
      }),
    );

    const props = {
      clusterId: "cluster-1",
      podsByUid: new Map([
        [
          "uid-1",
          {
            metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
            spec: { containers: [{ name: "api" }] },
          } as unknown as import("$shared/model/clusters").PodItem,
        ],
      ]),
      metricsByKey: new Map(),
      metricsError: null,
      request: null,
    };

    const view = render(PodWorkbenchPanel, { props });

    await waitFor(() => {
      expect(
        window.localStorage.getItem(getPodsWorkbenchStateKey("cluster-1", "balanced")),
      ).toContain('"collapsedPaneIndexes":[1]');
    });

    setDashboardDataProfile("realtime");
    await waitFor(() => {
      expect(
        window.localStorage.getItem(getPodsWorkbenchStateKey("cluster-1", "realtime")),
      ).toContain('"collapsedPaneIndexes":[]');
    });

    setDashboardDataProfile("balanced");
    await waitFor(() => {
      expect(
        window.localStorage.getItem(getPodsWorkbenchStateKey("cluster-1", "balanced")),
      ).toContain('"collapsedPaneIndexes":[1]');
    });

    view.unmount();
    setDashboardDataProfile("balanced");
  });

  it("keeps a pod workbench tab open when close confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(PodWorkbenchPanel, {
      props: {
        clusterId: "cluster-1",
        podsByUid: new Map([
          [
            "uid-1",
            {
              metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
              spec: { containers: [{ name: "api" }] },
            } as unknown as import("$shared/model/clusters").PodItem,
          ],
        ]),
        metricsByKey: new Map(),
        metricsError: null,
        request: {
          token: 1,
          kind: "logs",
          podUid: "uid-1",
        },
      },
    });

    await waitFor(() => {
      expect(view.getByRole("button", { name: "Close api-0 tab" })).toBeInTheDocument();
    });

    await fireEvent.click(view.getByRole("button", { name: "Close api-0 tab" }));

    expect(view.getByRole("button", { name: "Close api-0 tab" })).toBeInTheDocument();
  });

  it("asks confirmation before shrinking pod pane layout when hidden panes contain tabs", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    window.localStorage.setItem(
      getPodsWorkbenchStateKey("cluster-1", "balanced"),
      JSON.stringify({
        version: 1,
        tabs: [
          { kind: "logs", name: "api-0", namespace: "prod", pinned: false },
          { kind: "yaml", name: "api-0", namespace: "prod", pinned: false },
        ],
        activeTabId: "logs:prod/api-0",
        layout: "dual",
        paneTabIds: ["logs:prod/api-0", "yaml:prod/api-0", null],
        collapsedPaneIndexes: [],
        closedTabs: [],
        workbenchCollapsed: false,
        workbenchFullscreen: false,
      }),
    );
    const view = render(PodWorkbenchPanel, {
      props: {
        clusterId: "cluster-1",
        podsByUid: new Map([
          [
            "uid-1",
            {
              metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
              spec: { containers: [{ name: "api" }] },
            } as unknown as import("$shared/model/clusters").PodItem,
          ],
        ]),
        metricsByKey: new Map(),
        metricsError: null,
        request: null,
      },
    });

    await waitFor(() => {
      const selects = view.container.querySelectorAll("select");
      expect(selects.length).toBeGreaterThan(0);
      expect((selects[0] as HTMLSelectElement).value).toBe("dual");
    });

    const layoutSelect = view.container.querySelector("select");
    expect(layoutSelect).toBeTruthy();
    if (!layoutSelect) return;

    await fireEvent.change(layoutSelect, { target: { value: "single" } });

    await waitFor(() => {
      expect(view.getByText("Pane 2")).toBeInTheDocument();
    });
  });
});
