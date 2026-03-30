import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { NodeItem } from "$shared/model/clusters";
import DataSheet from "./data-sheet.svelte";

const { kubectlRawArgsFront, kubectlRawFront } = vi.hoisted(() => ({
  kubectlRawArgsFront: vi.fn(),
  kubectlRawFront: vi.fn(),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront,
  kubectlRawFront,
}));

describe("nodes data-sheet", () => {
  it("loads top node and events data and triggers edit action from header", async () => {
    kubectlRawArgsFront.mockImplementation(async (args: string[]) => {
      if (args[0] === "get") {
        return {
          code: 0,
          errors: "",
          output: JSON.stringify({ items: [] }),
        };
      }
      return {
        code: 0,
        errors: "",
        output: JSON.stringify({
          items: [
            {
              type: "Warning",
              reason: "NodeNotReady",
              message: "node is not ready",
              eventTime: "2026-03-13T12:00:00Z",
            },
          ],
        }),
      };
    });
    kubectlRawFront.mockResolvedValue({
      code: 0,
      errors: "",
      output: "NAME CPU(cores) CPU% MEMORY(bytes) MEMORY%\nworker-1 250m 12% 1024Mi 34%\n",
    });

    const data = writable<NodeItem | null>({
      metadata: {
        name: "worker-1",
        namespace: "",
        creationTimestamp: "2026-03-13T10:00:00Z",
        labels: {},
      },
      spec: {
        unschedulable: false,
        taints: [],
      },
      status: {
        conditions: [{ type: "Ready", status: "True" }],
        addresses: [],
        nodeInfo: {
          operatingSystem: "linux",
          architecture: "amd64",
          osImage: "Ubuntu",
          kernelVersion: "6.8",
          containerRuntimeVersion: "containerd://1.7",
          kubeletVersion: "v1.32.0",
        },
        capacity: { cpu: "4", memory: "8Gi", "ephemeral-storage": "20Gi", pods: "110" },
        allocatable: { cpu: "3900m", memory: "7Gi", "ephemeral-storage": "18Gi", pods: "110" },
      },
    } as unknown as NodeItem);
    const isOpen = writable(true);
    const focus = writable<{ section: "top" | "events" | null; token: number }>({
      section: null,
      token: 0,
    });
    const onEditYaml = vi.fn();

    const { getByRole, getByText, getAllByText } = render(DataSheet, {
      props: {
        clusterId: "cluster-1",
        data,
        isOpen,
        focus,
        onShell: vi.fn(),
        onEditYaml,
        onToggleCordon: vi.fn(),
        onDrain: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(getAllByText("250m").length).toBeGreaterThanOrEqual(1);
      expect(getByText("node is not ready")).toBeInTheDocument();
    });

    await fireEvent.click(getByRole("button", { name: "Edit node YAML" }));

    await waitFor(() => {
      expect(onEditYaml).toHaveBeenCalledTimes(1);
    });
  });
});
