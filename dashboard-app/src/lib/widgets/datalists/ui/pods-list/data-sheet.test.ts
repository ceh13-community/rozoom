import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { PodItem } from "$shared/model/clusters";
import DataSheet from "./data-sheet.svelte";

vi.mock("$features/pod-details", () => {
  return {
    loadPodEvents: vi.fn().mockResolvedValue([]),
    podPhaseToState: vi.fn().mockReturnValue("ready"),
    containerLabelToState: vi.fn().mockReturnValue("ready"),
    extractPodIp: vi.fn().mockReturnValue("10.0.0.1"),
  };
});

describe("data-sheet action bar", () => {
  it("closes sheet and triggers shell action", async () => {
    const pod: Partial<PodItem> = {
      metadata: { name: "api-0", namespace: "default", uid: "uid-1" },
      spec: { nodeName: "node-1", containers: [] },
    };
    const data = writable(pod);
    const isOpen = writable(true);
    const onShell = vi.fn();

    const { getByRole } = render(DataSheet, {
      props: {
        clusterId: "cluster-1",
        data,
        isOpen,
        metricsByKey: new Map(),
        metricsError: null,
        onShell,
        onAttach: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onPreviousLogs: vi.fn(),
        onDownloadYaml: vi.fn(),
        onExportIncident: vi.fn(),
        onEvict: vi.fn(),
        onPortForward: vi.fn(),
        onLogs: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Shell" }));

    await waitFor(() => {
      expect(onShell).toHaveBeenCalledTimes(1);
    });

    let openValue = true;
    const unsub = isOpen.subscribe((value) => {
      openValue = value;
    });
    unsub();
    expect(openValue).toBe(false);
  });

  it("renders distinct download/export actions and triggers delete action", async () => {
    const pod: Partial<PodItem> = {
      metadata: { name: "api-0", namespace: "default", uid: "uid-1" },
      spec: { nodeName: "node-1", containers: [] },
    };
    const data = writable(pod);
    const isOpen = writable(true);
    const onDelete = vi.fn();

    const { getByRole } = render(DataSheet, {
      props: {
        clusterId: "cluster-1",
        data,
        isOpen,
        metricsByKey: new Map(),
        metricsError: null,
        onShell: vi.fn(),
        onAttach: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onPreviousLogs: vi.fn(),
        onDownloadYaml: vi.fn(),
        onExportIncident: vi.fn(),
        onEvict: vi.fn(),
        onPortForward: vi.fn(),
        onLogs: vi.fn(),
        onDelete,
      },
    });

    expect(getByRole("button", { name: "Download YAML" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Copy kubectl describe" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Run debug describe" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Copy kubectl debug" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Previous logs" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Export incident" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });
});
