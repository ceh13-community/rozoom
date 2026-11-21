import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDashboardDataProfile } from "$shared/lib/dashboard-data-profile.svelte";
import PodWorkbenchPanel from "./pod-workbench-panel.svelte";
import { getPodsWorkbenchStateKey } from "./workbench-session";
import { kubectlRawArgsFront, kubectlStreamArgsFront } from "$shared/api/kubectl-proxy";

const toast = vi.hoisted(() => vi.fn());
vi.mock("svelte-sonner", () => ({ toast }));

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

vi.mock("$shared/ui/yaml-editor.svelte", async () => ({
  default: (await import("../../../../../test/mocks/yaml-editor-stub.svelte")).default,
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

  it("closes a logs tab without a dialog and Reopen brings it back", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
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

    await waitFor(() => {
      expect(view.queryByRole("button", { name: "Close api-0 tab" })).not.toBeInTheDocument();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("keeps every tab open when the pod pane layout shrinks", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
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
      expect(view.getByRole("button", { name: "2 panes" })).toHaveAttribute("aria-pressed", "true");
    });

    await fireEvent.click(view.getByRole("button", { name: "1 pane" }));

    await waitFor(() => {
      expect(view.getByRole("button", { name: "1 pane" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(view.getAllByRole("button", { name: "Close api-0 tab" })).toHaveLength(2);
  });

  it("Undo in the toast of the closed Logs reopens Logs, not the YAML closed after it", async () => {
    toast.mockClear();
    const podsByUid = new Map([
      [
        "uid-1",
        {
          metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
          spec: { containers: [{ name: "api" }] },
        } as unknown as import("$shared/model/clusters").PodItem,
      ],
    ]);
    const props = {
      clusterId: "cluster-1",
      podsByUid,
      metricsByKey: new Map(),
      metricsError: null,
      request: { token: 1, kind: "logs" as const, podUid: "uid-1" },
    };
    const view = render(PodWorkbenchPanel, { props });
    await waitFor(() => expect(view.getByText("Pod logs: prod/api-0")).toBeInTheDocument());
    await view.rerender({
      ...props,
      request: { token: 2, kind: "yaml" as const, podUid: "uid-1" },
    });
    await waitFor(() =>
      expect(view.getAllByRole("button", { name: "Close api-0 tab" })).toHaveLength(2),
    );

    // Logs first, then YAML.
    await fireEvent.click(view.getAllByRole("button", { name: "Close api-0 tab" })[0]);
    await waitFor(() =>
      expect(view.getAllByRole("button", { name: "Close api-0 tab" })).toHaveLength(1),
    );
    await fireEvent.click(view.getByRole("button", { name: "Close api-0 tab" }));
    await waitFor(() =>
      expect(view.queryByRole("button", { name: "Close api-0 tab" })).not.toBeInTheDocument(),
    );
    expect(toast).toHaveBeenCalledTimes(2);

    const logsUndo = (toast.mock.calls[0][1] as { action: { onClick: () => void } }).action;
    logsUndo.onClick();

    await waitFor(() => expect(view.getByText("Pod logs: prod/api-0")).toBeInTheDocument());
    expect(view.getAllByRole("button", { name: "Close api-0 tab" })).toHaveLength(1);
  });

  it("asks before Refresh or Reload from cluster replaces edited YAML", async () => {
    const pod = {
      metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
      spec: { containers: [{ name: "api" }] },
    } as unknown as import("$shared/model/clusters").PodItem;
    const view = render(PodWorkbenchPanel, {
      props: {
        clusterId: "cluster-1",
        podsByUid: new Map([["uid-1", pod]]),
        metricsByKey: new Map(),
        metricsError: null,
        request: { token: 1, kind: "yaml" as const, podUid: "uid-1" },
      },
    });
    const editor = () => view.getByLabelText("YAML editor") as HTMLTextAreaElement;
    await waitFor(() => expect(editor().value).toContain("name: api-0"));
    await fireEvent.input(editor(), { target: { value: "my edit" } });

    const rawMock = vi.mocked(kubectlRawArgsFront);
    const defaultRaw = rawMock.getMockImplementation();
    rawMock.mockImplementation(async (args: string[]) =>
      args.includes("yaml")
        ? { output: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: fresh\n", errors: "", code: 0 }
        : { output: "", errors: "", code: 0 },
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await fireEvent.click(view.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
      expect(confirmSpy.mock.calls[0][0]).toContain("Discard your edits");
      expect(editor().value).toBe("my edit");

      confirmSpy.mockReturnValue(true);
      await fireEvent.click(view.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(editor().value).toContain("name: fresh"));
    } finally {
      if (defaultRaw) rawMock.mockImplementation(defaultRaw);
    }
  });

  it("a one-shot read that returns late does not overwrite the running stream", async () => {
    const rawMock = vi.mocked(kubectlRawArgsFront);
    const streamMock = vi.mocked(kubectlStreamArgsFront);
    const defaultRaw = rawMock.getMockImplementation();
    let releasePrevious: (value: { output: string; errors: string; code: number }) => void = () =>
      undefined;
    rawMock.mockImplementation(async (args: string[]) => {
      if (args.includes("--previous")) {
        // The Previous read hangs until the stream is already running.
        return new Promise((resolve) => {
          releasePrevious = resolve;
        });
      }
      return { output: "", errors: "", code: 0 };
    });
    let streamHandlers: { onStdoutData?: (chunk: string) => void } = {};
    streamMock.mockImplementation(async (_args, _options, handlers) => {
      streamHandlers = handlers ?? {};
      return { child: {}, stop: async () => undefined } as never;
    });

    const { getByTestId, queryByText, findByText } = render(PodWorkbenchPanel, {
      props: {
        clusterId: "cluster-1",
        podsByUid: new Map([
          [
            "uid-1",
            {
              metadata: { uid: "uid-1", name: "api-0", namespace: "prod" },
              spec: { containers: [{ name: "api" }] },
              status: {
                phase: "Running",
                containerStatuses: [
                  {
                    name: "api",
                    ready: true,
                    restartCount: 1,
                    state: { running: { startedAt: "2026-11-21T10:00:00Z" } },
                    lastState: { terminated: { exitCode: 1, message: "", reason: "Error" } },
                  },
                ],
              },
            } as unknown as import("$shared/model/clusters").PodItem,
          ],
        ]),
        metricsByKey: new Map(),
        metricsError: null,
        request: { token: 1, kind: "logs", podUid: "uid-1", logsPrevious: true },
      },
    });

    // Previous is on and its read is in flight; turning it off starts the live stream.
    await waitFor(() => expect(getByTestId("logs-previous-toggle")).toHaveTextContent("On"));
    await fireEvent.click(getByTestId("logs-previous-toggle"));
    await waitFor(() => expect(streamHandlers.onStdoutData).toBeTypeOf("function"));
    streamHandlers.onStdoutData?.("2026-11-21T10:00:01Z live-1\n2026-11-21T10:00:02Z live-2\n");
    await findByText(/live-2/);

    releasePrevious({ output: "2026-11-21T09:00:00Z old-instance\n", errors: "", code: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryByText(/old-instance/)).not.toBeInTheDocument();
    expect(queryByText(/live-1/)).toBeInTheDocument();

    if (defaultRaw) rawMock.mockImplementation(defaultRaw);
    streamMock.mockImplementation(
      async () => ({ child: {}, stop: async () => undefined }) as never,
    );
  });
});
