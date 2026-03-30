import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { writable } from "svelte/store";
import ResourceDetailsSheet from "./resource-details-sheet.svelte";

describe("resource details sheet expand sections", () => {
  it("expands labels details", async () => {
    const selectedItem = writable({
      metadata: {
        name: "api",
        namespace: "apps",
        labels: { app: "api" },
        annotations: {},
      },
      spec: {},
      status: {},
    });
    const isOpen = writable(true);
    const view = render(ResourceDetailsSheet, {
      props: {
        clusterId: "test-cluster",
        title: "Stateful Set",
        selectedItem,
        isOpen,
      },
    });

    expect(view.queryByText("app")).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: /1 Labels/i }));
    expect(view.getByText("app")).toBeInTheDocument();
  });

  it("expands pod anti-affinity details for stateful set", async () => {
    const selectedItem = writable({
      metadata: {
        name: "api",
        namespace: "apps",
        labels: {},
        annotations: {},
      },
      spec: {
        template: {
          spec: {
            affinity: {
              podAntiAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: [
                  { topologyKey: "kubernetes.io/hostname" },
                ],
              },
            },
          },
        },
      },
      status: {},
    });
    const isOpen = writable(true);
    const view = render(ResourceDetailsSheet, {
      props: {
        clusterId: "test-cluster",
        title: "Stateful Set",
        selectedItem,
        isOpen,
      },
    });

    await fireEvent.click(view.getByRole("button", { name: /1 Rule/i }));
    expect(view.getByText(/topologyKey/)).toBeInTheDocument();
  });

  it("expands tolerations details", async () => {
    const selectedItem = writable({
      metadata: {
        name: "node-1",
        namespace: "default",
        labels: {},
        annotations: {},
      },
      spec: {
        tolerations: [
          {
            key: "node.kubernetes.io/not-ready",
            operator: "Exists",
            effect: "NoExecute",
          },
          {
            key: "dedicated",
            operator: "Equal",
            value: "batch",
            effect: "NoSchedule",
          },
        ],
      },
      status: {
        conditions: [],
      },
    });
    const isOpen = writable(true);
    const view = render(ResourceDetailsSheet, {
      props: {
        clusterId: "test-cluster",
        title: "Node",
        selectedItem,
        isOpen,
      },
    });

    const tolerationsCard = view.getByText("Tolerations").parentElement;
    const tolerationsToggle = tolerationsCard?.querySelector("button");
    expect(tolerationsToggle).toBeTruthy();
    await fireEvent.click(tolerationsToggle as HTMLButtonElement);
    expect(view.getAllByText(/node.kubernetes.io\/not-ready/).length).toBeGreaterThan(0);
  });

  it("expands job conditions details", async () => {
    const selectedItem = writable({
      metadata: {
        name: "backup",
        namespace: "ops",
        labels: {},
        annotations: {},
      },
      spec: {},
      status: {
        conditions: [
          { type: "Complete", status: "True" },
          { type: "Failed", status: "False" },
        ],
      },
    });
    const isOpen = writable(true);
    const view = render(ResourceDetailsSheet, {
      props: {
        clusterId: "test-cluster",
        title: "Job",
        selectedItem,
        isOpen,
      },
    });

    await fireEvent.click(view.getByRole("button", { name: /Complete/i }));
    expect(view.getByText("Complete: True")).toBeInTheDocument();
    expect(view.getByText("Failed: False")).toBeInTheDocument();
  });
});
