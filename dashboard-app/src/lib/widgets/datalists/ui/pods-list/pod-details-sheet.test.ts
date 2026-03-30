import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { PodItem } from "$shared/model/clusters";
import PodDetailsSheet from "./pod-details-sheet.svelte";

vi.mock("$features/pod-details", () => ({
  loadPodEvents: vi.fn(async () => []),
}));

describe("PodDetailsSheet", () => {
  it("renders pod metadata and closes before running an action", async () => {
    const data = writable<Partial<PodItem> | null>({
      metadata: {
        name: "api-0",
        namespace: "prod",
        uid: "uid-1",
        labels: { app: "api" },
      },
      spec: {
        nodeName: "node-a",
        serviceAccountName: "default",
        containers: [{ name: "api", image: "repo/api:1.0.0" }],
      },
      status: {
        phase: "Running",
        podIP: "10.0.0.1",
        containerStatuses: [{ name: "api", ready: true, restartCount: 1, state: { running: {} } }],
      },
    } as unknown as Partial<PodItem>);
    const isOpen = writable(true);
    const onShell = vi.fn();

    const { getByText, getByRole } = render(PodDetailsSheet, {
      props: {
        data,
        isOpen,
        clusterId: "cluster-a",
        metricsByKey: new Map([["prod/api-0", { cpu: "12m", memory: "48Mi" }]]),
        metricsError: null,
        runtimeProfileLabel: "Balanced profile",
        runtimeSourceState: "live",
        runtimeLastUpdatedLabel: "updated just now",
        runtimeDetail: "Pod sync is healthy.",
        runtimeReason: "Polling pods every 30s.",
        runtimeRequestPath: "snapshot refresh every 30s",
        runtimeSyncError: null,
        onShell,
        onAttach: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onPreviousLogs: vi.fn(),
        onEvict: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByText("Pod: api-0")).toBeInTheDocument();
    expect(getByText("repo/api:1.0.0")).toBeInTheDocument();
    // CPU/Memory now shown via ResourceMetricsBadge (not in grid)
    expect(getByText("Pod: api-0")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Open pod shell" }));

    await waitFor(() => {
      expect(onShell).toHaveBeenCalledTimes(1);
    });

    let openValue = true;
    const unsubscribe = isOpen.subscribe((value) => {
      openValue = value;
    });
    unsubscribe();
    expect(openValue).toBe(false);
  });
});
