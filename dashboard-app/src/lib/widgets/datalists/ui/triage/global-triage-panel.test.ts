import { render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTriageDiscoveryCache } from "$features/workloads-management";
import GlobalTriagePanel from "./global-triage-panel.svelte";

const mockKubectlJson = vi.hoisted(() => vi.fn());
const mockKubectlRawArgsFront = vi.hoisted(() => vi.fn());

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlJson: mockKubectlJson,
  kubectlRawArgsFront: mockKubectlRawArgsFront,
}));

describe("global-triage-panel", () => {
  beforeEach(() => {
    resetTriageDiscoveryCache();
    mockKubectlJson.mockReset();
    mockKubectlRawArgsFront.mockReset();
  });

  it("renders aggregated problem rows with severity badges", async () => {
    mockKubectlRawArgsFront.mockResolvedValue({
      output:
        "pods\nnamespaces\ndeployments\ndaemonsets\nstatefulsets\nreplicasets\nreplicationcontrollers\njobs\ncronjobs\npersistentvolumeclaims\npersistentvolumes\nservices\nendpoints\nendpointslices\ningresses\nnetworkpolicies\nhorizontalpodautoscalers\npoddisruptionbudgets\nnodes\n",
      errors: "",
      code: 0,
    });
    mockKubectlJson.mockImplementation((command: string) => {
      if (command.includes("get pods")) {
        return Promise.resolve({
          items: [
            {
              metadata: { name: "pod-a", namespace: "default" },
              status: { phase: "Pending", containerStatuses: [{ restartCount: 2 }] },
            },
          ],
        });
      }
      return Promise.resolve({ items: [] });
    });

    const { findAllByText, findByRole, findByText } = render(GlobalTriagePanel, {
      props: {
        data: {
          title: "Global Triage - Cluster: minikube",
          slug: "cluster-a",
          workload: "globaltriage",
          sort_field: null,
        },
      },
    });

    expect((await findAllByText("pod-a")).length).toBeGreaterThan(0);
    expect(await findByText("Pods")).toBeInTheDocument();
    expect(await findByRole("link", { name: "pod-a" })).toHaveAttribute(
      "href",
      "/dashboard/clusters/cluster-a?workload=pods&sort_field=name",
    );
  });

  it("survives partial unsupported resource fetches and reports coverage", async () => {
    mockKubectlRawArgsFront.mockResolvedValue({
      output:
        "pods\nnamespaces\ndeployments\ndaemonsets\nstatefulsets\nreplicasets\nreplicationcontrollers\njobs\ncronjobs\npersistentvolumeclaims\npersistentvolumes\nservices\nendpoints\nendpointslices\ningresses\nnetworkpolicies\nhorizontalpodautoscalers\npoddisruptionbudgets\nnodes\n",
      errors: "",
      code: 0,
    });
    mockKubectlJson.mockImplementation((command: string) => {
      if (command.includes("get ingresses")) {
        return Promise.reject(new Error('the server doesn\'t have a resource type "ingresses"'));
      }
      return Promise.resolve({ items: [] });
    });

    const { findByText } = render(GlobalTriagePanel, {
      props: {
        data: {
          title: "Global Triage - Cluster: minikube",
          slug: "cluster-a",
          workload: "globaltriage",
          sort_field: null,
        },
      },
    });

    expect(await findByText(/Unsupported/i)).toBeInTheDocument();
  });

  it("marks missing API resources as unsupported before fetching rows", async () => {
    mockKubectlRawArgsFront.mockResolvedValue({
      output: "pods\nservices\n",
      errors: "",
      code: 0,
    });
    mockKubectlJson.mockResolvedValue({ items: [] });

    const { findByText } = render(GlobalTriagePanel, {
      props: {
        data: {
          title: "Global Triage - Cluster: minikube",
          slug: "cluster-a",
          workload: "globaltriage",
          sort_field: null,
        },
      },
    });

    expect(await findByText(/Unsupported/i)).toBeInTheDocument();
  });

  it("treats kubectlJson string failures as unsupported coverage instead of empty success", async () => {
    mockKubectlRawArgsFront.mockResolvedValue({
      output:
        "pods\nnamespaces\ndeployments\ndaemonsets\nstatefulsets\nreplicasets\nreplicationcontrollers\njobs\ncronjobs\npersistentvolumeclaims\npersistentvolumes\nservices\nendpoints\nendpointslices\ningresses\nnetworkpolicies\nhorizontalpodautoscalers\npoddisruptionbudgets\nnodes\n",
      errors: "",
      code: 0,
    });
    mockKubectlJson.mockImplementation((command: string) => {
      if (command.includes("get pods")) {
        return Promise.resolve('the server doesn\'t have a resource type "pods"');
      }
      return Promise.resolve({ items: [] });
    });

    const { findByText } = render(GlobalTriagePanel, {
      props: {
        data: {
          title: "Global Triage - Cluster: minikube",
          slug: "cluster-a",
          workload: "globaltriage",
          sort_field: null,
        },
      },
    });

    expect(await findByText(/Supported/i)).toBeInTheDocument();
    expect(await findByText(/Unsupported/i)).toBeInTheDocument();
  });
});
