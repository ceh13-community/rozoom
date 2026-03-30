import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomResourcesList from "./custom-resources-list.svelte";

const { fetchNamespacedSnapshotItems, kubectlRawArgsFront } = vi.hoisted(() => ({
  fetchNamespacedSnapshotItems: vi.fn(),
  kubectlRawArgsFront: vi.fn(),
}));

vi.mock("../common/namespaced-snapshot", () => ({
  fetchNamespacedSnapshotItems,
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront,
}));

vi.mock("$features/namespace-management", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$features/namespace-management")>();
  return {
    ...actual,
    selectedNamespace: writable("all"),
  };
});

describe("custom resources list", () => {
  beforeEach(() => {
    fetchNamespacedSnapshotItems.mockReset();
    kubectlRawArgsFront.mockReset();
    kubectlRawArgsFront.mockResolvedValue({
      output: JSON.stringify({ items: [] }),
      errors: "",
    });
  });

  it("loads custom resource instances for a selected CRD", async () => {
    fetchNamespacedSnapshotItems.mockResolvedValue([
      {
        apiVersion: "example.com/v1",
        kind: "Widget",
        metadata: { name: "demo", namespace: "apps", uid: "widget-1" },
        status: { phase: "Ready" },
      },
    ]);

    const { getByText, getByLabelText, findByText } = render(CustomResourcesList, {
      props: {
        data: {
          title: "Custom Resource Definitions - Cluster: minikube",
          slug: "minikube",
          workload: "customresourcedefinitions",
          sort_field: null,
          workloadKey: "customresourcedefinitions",
          items: [
            {
              metadata: { name: "widgets.example.com", uid: "crd-1" },
              spec: {
                group: "example.com",
                scope: "Namespaced",
                names: { plural: "widgets" },
                versions: [{ name: "v1", storage: true, served: true }],
              },
            },
          ],
        },
      },
    });

    await fireEvent.click(getByText("widgets.example.com"));
    await fireEvent.click(getByLabelText("Browse custom resource instances"));

    expect(fetchNamespacedSnapshotItems).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: "minikube",
        resource: "widgets.example.com",
      }),
    );
    expect(await findByText("Instances for widgets.example.com")).toBeInTheDocument();
    expect(await findByText("demo")).toBeInTheDocument();
    expect(await findByText("Ready")).toBeInTheDocument();
  });

  it("loads cluster-scoped custom resource instances without namespace fanout", async () => {
    kubectlRawArgsFront.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            apiVersion: "example.com/v1",
            kind: "ClusterWidget",
            metadata: { name: "global-widget", uid: "widget-2" },
            status: { conditions: [{ type: "Available", status: "True" }] },
          },
        ],
      }),
      errors: "",
    });

    const { getByText, getByLabelText } = render(CustomResourcesList, {
      props: {
        data: {
          title: "Custom Resource Definitions - Cluster: minikube",
          slug: "minikube",
          workload: "customresourcedefinitions",
          sort_field: null,
          workloadKey: "customresourcedefinitions",
          items: [
            {
              metadata: { name: "clusterwidgets.example.com", uid: "crd-2" },
              spec: {
                group: "example.com",
                scope: "Cluster",
                names: { plural: "clusterwidgets" },
                versions: [{ name: "v1", storage: true, served: true }],
              },
            },
          ],
        },
      },
    });

    await fireEvent.click(getByText("clusterwidgets.example.com"));
    await fireEvent.click(getByLabelText("Browse custom resource instances"));

    await waitFor(() => {
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(
        ["get", "clusterwidgets.example.com", "-o", "json"],
        expect.objectContaining({ clusterId: "minikube" }),
      );
    });
  });

  it("shows watcher controls and refreshes CRDs through polling runtime", async () => {
    kubectlRawArgsFront.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: { name: "gadgets.example.com", uid: "crd-3" },
            spec: {
              group: "example.com",
              scope: "Namespaced",
              names: { plural: "gadgets" },
              versions: [{ name: "v1", storage: true, served: true }],
            },
          },
        ],
      }),
      errors: "",
    });

    const { getByText, getByDisplayValue } = render(CustomResourcesList, {
      props: {
        data: {
          title: "Custom Resource Definitions - Cluster: minikube",
          slug: "minikube",
          workload: "customresourcedefinitions",
          sort_field: null,
          workloadKey: "customresourcedefinitions",
          items: [],
        },
      },
    });

    expect(getByText("Watcher: On")).toBeInTheDocument();
    expect(getByText("Sync sec")).toBeInTheDocument();
    expect(getByDisplayValue("30")).toBeInTheDocument();
    expect(getByText("Reset")).toBeInTheDocument();

    await waitFor(() => {
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(
        ["get", "customresourcedefinitions", "-o", "json"],
        expect.objectContaining({ clusterId: "minikube" }),
      );
    });

    expect(await waitFor(() => getByText("gadgets.example.com"))).toBeTruthy();
  });

  it("reapplies route snapshot rows when a CRD changes with the same uid", async () => {
    kubectlRawArgsFront.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: {
              name: "widgets.example.com",
              uid: "crd-1",
              resourceVersion: "1",
              generation: 1,
            },
            spec: {
              group: "example.com",
              scope: "Namespaced",
              names: { plural: "widgets" },
              versions: [{ name: "v1", storage: true, served: true }],
            },
          },
        ],
      }),
      errors: "",
    });

    const view = render(CustomResourcesList, {
      props: {
        data: {
          title: "Custom Resource Definitions - Cluster: minikube",
          slug: "minikube",
          workload: "customresourcedefinitions",
          sort_field: null,
          workloadKey: "customresourcedefinitions",
          items: [
            {
              metadata: {
                name: "widgets.example.com",
                uid: "crd-1",
                resourceVersion: "1",
                generation: 1,
              },
              spec: {
                group: "example.com",
                scope: "Namespaced",
                names: { plural: "widgets" },
                versions: [{ name: "v1", storage: true, served: true }],
              },
            },
          ],
        },
      },
    });

    expect(await view.findByText("v1")).toBeInTheDocument();

    await view.rerender({
      data: {
        title: "Custom Resource Definitions - Cluster: minikube",
        slug: "minikube",
        workload: "customresourcedefinitions",
        sort_field: null,
        workloadKey: "customresourcedefinitions",
        items: [
          {
            metadata: {
              name: "widgets.example.com",
              uid: "crd-1",
              resourceVersion: "2",
              generation: 2,
            },
            spec: {
              group: "example.com",
              scope: "Namespaced",
              names: { plural: "widgets" },
              versions: [{ name: "v2", storage: true, served: true }],
            },
          },
        ],
      },
    });

    await waitFor(() => {
      expect(view.getByText("v2")).toBeInTheDocument();
    });
  });
});
