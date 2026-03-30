import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSelectedNamespace } from "$features/namespace-management";
import { setDashboardDataProfile } from "$shared/lib/dashboard-data-profile.svelte";
import ConfigurationList from "./configuration-list.svelte";
import * as kubectlProxy from "$shared/api/kubectl-proxy";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlJson: vi.fn().mockResolvedValue({ items: [] }),
  kubectlRawArgsFront: vi
    .fn()
    .mockResolvedValue({ code: 0, output: "apiVersion: v1\nkind: ConfigMap\n", errors: "" }),
}));

vi.mock("$features/shell", () => ({
  openShellModal: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/appdata"),
  path: {
    appDataDir: vi.fn().mockResolvedValue("/tmp/appdata"),
    join: vi.fn(async (...parts: string[]) => parts.join("/")),
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => {
  class MockCommand {
    static sidecar() {
      return new MockCommand();
    }

    stdout = { on: vi.fn() };
    stderr = { on: vi.fn() };
    on = vi.fn();
    spawn = vi.fn().mockResolvedValue({
      kill: vi.fn().mockResolvedValue(undefined),
    });
  }

  return {
    Command: MockCommand,
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: "AppData" },
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}));

describe("configuration-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    setSelectedNamespace("cluster-a", "all");
    setDashboardDataProfile("balanced");
  });

  it("renders resource rows for configuration workload", () => {
    const { container, getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            {
              metadata: {
                name: "kube-root-ca.crt",
                namespace: "default",
                creationTimestamp: "2026-02-20T10:00:00Z",
              },
              data: {
                ca: "cert",
              },
            },
          ],
        },
      },
    });

    expect(getByText("ConfigMaps")).toBeInTheDocument();
    expect(getByText("Keys")).toBeInTheDocument();
    expect(getByText("kube-root-ca.crt")).toBeInTheDocument();
    expect(getByText("default")).toBeInTheDocument();
    expect(container.querySelector("tbody tr td:nth-child(6)")?.textContent?.trim()).toBe("1");
  });

  it("shows empty state for unmatched search", async () => {
    const { getByPlaceholderText, findByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            { metadata: { name: "first", namespace: "default" }, data: {} },
            { metadata: { name: "second", namespace: "kube-system" }, data: {} },
          ],
        },
      },
    });

    const input = getByPlaceholderText("Filter configmaps...") as HTMLInputElement;
    input.value = "does-not-exist";
    await fireEvent.input(input);
    expect(await findByText("No results for the current filter.")).toBeInTheDocument();
  });

  it("sorts rows by problem score by default (pods-style priority)", () => {
    const { container } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            { metadata: { name: "healthy", namespace: "default" }, data: { key: "ok" } },
            { metadata: { name: "problematic", namespace: "default" }, data: {} },
          ],
        },
      },
    });

    const firstNameCell = container.querySelector("tbody tr td:nth-child(3)");
    expect(firstNameCell?.textContent?.trim()).toBe("problematic");
  });

  it("defaults to name sorting for access-control workloads", () => {
    const { container } = render(ConfigurationList, {
      props: {
        data: {
          title: "Roles - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "roles",
          sort_field: null,
          workloadKey: "roles",
          items: [
            {
              metadata: { name: "z-role", namespace: "default" },
              rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get"] }],
            },
            {
              metadata: { name: "a-role", namespace: "default" },
              rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get"] }],
            },
          ],
        },
      },
    });

    const firstNameCell = container.querySelector("tbody tr td:nth-child(3)");
    expect(firstNameCell?.textContent?.trim()).toBe("a-role");
  });

  it("defaults StorageClasses to default-class first ordering", () => {
    const { container } = render(ConfigurationList, {
      props: {
        data: {
          title: "Storage Classes - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "storageclasses",
          sort_field: null,
          workloadKey: "storageclasses",
          items: [
            {
              metadata: { name: "slow" },
              provisioner: "example.com/slow",
            },
            {
              metadata: {
                name: "standard",
                annotations: { "storageclass.kubernetes.io/is-default-class": "true" },
              },
              provisioner: "k8s.io/minikube-hostpath",
            },
          ],
        },
      },
    });

    const firstNameCell = container.querySelector("tbody tr td:nth-child(3)");
    expect(firstNameCell?.textContent?.trim()).toBe("standard");
  });

  it("restores name-first sorting from persisted table state without exposing toolbar sort controls", () => {
    window.localStorage.setItem(
      "dashboard.configuration.table.state.v1:cluster-a:configmaps",
      JSON.stringify({ sortBy: "name", sortDirection: "asc", quickFilter: "all" }),
    );

    const { container, queryByLabelText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            { metadata: { name: "zzz-problem", namespace: "default" }, data: {} },
            { metadata: { name: "aaa-healthy", namespace: "default" }, data: { key: "ok" } },
          ],
        },
      },
    });

    expect(queryByLabelText("Sort preset")).not.toBeInTheDocument();
    const firstRow = container.querySelector("tbody tr td:nth-child(3)");
    expect(firstRow?.textContent?.trim()).toBe("aaa-healthy");
  });

  it("hides Problems-first preset for name-first workloads", () => {
    const { queryByLabelText, queryByRole } = render(ConfigurationList, {
      props: {
        data: {
          title: "Roles - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "roles",
          sort_field: null,
          workloadKey: "roles",
          items: [{ metadata: { name: "read-only", namespace: "default" }, rules: [] }],
        },
      },
    });

    expect(queryByLabelText("Sort preset")).not.toBeInTheDocument();
    expect(queryByRole("option", { name: "Problems first" })).not.toBeInTheDocument();
  });

  it("restores table sort and quick-filter state from localStorage without exposing extra toolbar controls", () => {
    window.localStorage.setItem(
      "dashboard.configuration.table.state.v1:cluster-a:configmaps",
      JSON.stringify({ sortBy: "name", sortDirection: "asc", quickFilter: "drifted" }),
    );

    const { queryByLabelText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            {
              metadata: {
                name: "z-drifted",
                namespace: "default",
                annotations: {
                  "kubectl.kubernetes.io/last-applied-configuration": JSON.stringify({
                    spec: { immutable: false },
                  }),
                },
              },
              spec: { immutable: true },
              data: { key: "value" },
            },
            { metadata: { name: "a-healthy", namespace: "default" }, data: { key: "ok" } },
          ],
        },
      },
    });

    expect(queryByLabelText("Sort preset")).not.toBeInTheDocument();
    expect(queryByLabelText("Quick filter")).not.toBeInTheDocument();
    expect(queryByText("z-drifted")).toBeInTheDocument();
    expect(queryByText("a-healthy")).not.toBeInTheDocument();
  });

  it("preserves workload route params when syncing the search query", async () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/clusters/dev?workload=configmaps&sort_field=name",
    );

    const { getByPlaceholderText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: dev",
          slug: "dev",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: "name",
          workloadKey: "configmaps",
          items: [{ metadata: { name: "first", namespace: "default" }, data: {} }],
        },
      },
    });

    const input = getByPlaceholderText("Filter configmaps...") as HTMLInputElement;
    input.value = "cache";
    await fireEvent.input(input);

    await waitFor(() => {
      expect(window.location.search).toContain("workload=configmaps");
      expect(window.location.search).toContain("sort_field=name");
      expect(window.location.search).toContain("q=cache");
    });
  });

  it("does not expose saved views, copy link, quick filter, or sort preset controls in the toolbar", () => {
    const { queryByLabelText, queryByPlaceholderText, queryByRole, queryByText } = render(
      ConfigurationList,
      {
        props: {
          data: {
            title: "ConfigMaps - Cluster: minikube",
            slug: "minikube",
            uuid: "cluster-a",
            workload: "configmaps",
            sort_field: null,
            workloadKey: "configmaps",
            items: [
              { metadata: { name: "first", namespace: "default" }, data: { key: "ok" } },
              { metadata: { name: "second", namespace: "default" }, data: {} },
            ],
          },
        },
      },
    );

    expect(queryByLabelText("Saved view")).not.toBeInTheDocument();
    expect(queryByPlaceholderText("View name")).not.toBeInTheDocument();
    expect(queryByLabelText("Quick filter")).not.toBeInTheDocument();
    expect(queryByLabelText("Sort preset")).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
    expect(queryByText("Saved view")).not.toBeInTheDocument();
  });

  it("shows pods-style watcher and table controls", () => {
    const { getByRole, getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [{ metadata: { name: "first", namespace: "default" }, data: {} }],
        },
      },
    });

    expect(getByRole("button", { name: "NS (1/1)" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
    expect(getByText("Watcher: On")).toBeInTheDocument();
    expect(getByText("Sync sec")).toBeInTheDocument();
    expect(getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(queryByText("Selected:")).not.toBeInTheDocument();
  });

  it("supports workload-style toolbar actions: namespaces, columns, watcher controls and csv", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const { getByRole, queryByLabelText, queryByPlaceholderText, findByRole, queryByText } = render(
      ConfigurationList,
      {
        props: {
          data: {
            title: "ConfigMaps - Cluster: minikube",
            slug: "minikube",
            uuid: "cluster-a",
            workload: "configmaps",
            sort_field: null,
            workloadKey: "configmaps",
            items: [{ metadata: { name: "first", namespace: "default" }, data: { key: "value" } }],
          },
        },
      },
    );

    await fireEvent.click(getByRole("button", { name: "NS (1/1)" }));
    await fireEvent.click(getByRole("button", { name: "Columns" }));
    expect(queryByPlaceholderText("View name")).not.toBeInTheDocument();
    expect(queryByLabelText("Saved view")).not.toBeInTheDocument();
    expect(queryByLabelText("Quick filter")).not.toBeInTheDocument();
    expect(queryByLabelText("Sort preset")).not.toBeInTheDocument();
    expect(queryByText("Saved view")).not.toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Download CSV" }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    await findByRole("button", { name: "Columns" });
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("loads watcher settings from localStorage and resets them", async () => {
    window.localStorage.setItem(
      "dashboard.configuration.watcher.settings.v2:cluster-a:configmaps",
      JSON.stringify({ enabled: false, refreshSeconds: 45, viewMode: "namespace" }),
    );

    const { getByDisplayValue, getByRole, findByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [{ metadata: { name: "first", namespace: "default" }, data: {} }],
        },
      },
    });

    await findByText("Watcher: Off");
    expect(getByDisplayValue("45")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Reset" }));
    expect(getByRole("button", { name: "Watcher: On" })).toBeInTheDocument();
    expect(getByDisplayValue("30")).toBeInTheDocument();
  });

  it("treats namespaces as cluster-scoped inventory in the toolbar and summary", () => {
    const { queryByRole, getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Namespaces - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "namespaces",
          sort_field: null,
          workloadKey: "namespaces",
          items: [
            {
              metadata: {
                name: "default",
                creationTimestamp: "2026-02-20T10:00:00Z",
              },
              status: { phase: "Active" },
            },
          ],
        },
      },
    });

    expect(queryByRole("button", { name: "NS (1/1)" })).not.toBeInTheDocument();
    expect(getByText("Scope:")).toBeInTheDocument();
    expect(getByText("Cluster-scoped")).toBeInTheDocument();
    expect(
      getByText("Scope: cluster inventory. Streaming watcher active for namespaces."),
    ).toBeInTheDocument();
  });

  it("does not run watcher refresh while document is hidden and resumes on visible", async () => {
    const originalVisibilityState = document.visibilityState;
    const setVisibility = (value: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        value,
        configurable: true,
      });
    };

    try {
      setDashboardDataProfile("low_load");
      setVisibility("hidden");
      const kubectlJsonMock = vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({ items: [] });

      render(ConfigurationList, {
        props: {
          data: {
            title: "ConfigMaps - Cluster: minikube",
            slug: "minikube",
            uuid: "cluster-a",
            workload: "configmaps",
            sort_field: null,
            workloadKey: "configmaps",
            items: [{ metadata: { name: "first", namespace: "default" }, data: {} }],
          },
        },
      });

      await Promise.resolve();
      expect(kubectlJsonMock).not.toHaveBeenCalled();

      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      await waitFor(() => {
        expect(kubectlJsonMock).toHaveBeenCalled();
      });
    } finally {
      setDashboardDataProfile("balanced");
      setVisibility(originalVisibilityState as DocumentVisibilityState);
    }
  });

  it("keeps actions column on the left and opens details in sheet", async () => {
    const { container, getByText, getByRole } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            {
              metadata: {
                name: "first",
                namespace: "default",
                creationTimestamp: "2026-02-17T22:33:46Z",
                labels: { app: "demo" },
                annotations: { owner: "platform" },
                managedFields: [
                  {
                    manager: "kubectl-client-side-apply",
                    operation: "Apply",
                    time: "2026-02-17T22:40:00Z",
                  },
                ],
              },
              data: { "proxy.json": "{}" },
            },
          ],
        },
      },
    });

    const bodyRow = container.querySelector("tbody tr");
    expect(bodyRow).toBeTruthy();
    const cells = bodyRow?.querySelectorAll("td") ?? [];
    expect(cells.length).toBeGreaterThan(2);
    expect(cells[1]?.querySelector("button[aria-label^='Open actions for']")).toBeTruthy();

    await fireEvent.click(getByText("first"));
    expect(getByRole("complementary")).toBeInTheDocument();
    expect(getByText("Properties")).toBeInTheDocument();
    expect(getByText("Events")).toBeInTheDocument();
    expect(getByText("Managed Fields")).toBeInTheDocument();
    const editYaml = getByRole("button", { name: "Edit ConfigMap YAML" });
    expect(editYaml).toBeInTheDocument();
    await fireEvent.click(editYaml);
    expect(getByText("Fullscreen")).toBeInTheDocument();
  });

  it("filters data keys in details drawer", async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            {
              metadata: { name: "first", namespace: "default" },
              data: { "request-body.json": "{}", "response-body.json": "{}" },
            },
          ],
        },
      },
    });

    await fireEvent.click(getByText("first"));
    const searchInput = getByPlaceholderText("Search data keys...") as HTMLInputElement;
    searchInput.value = "request";
    await fireEvent.input(searchInput);

    expect(getByText("request-body.json")).toBeInTheDocument();
    expect(queryByText("response-body.json")).not.toBeInTheDocument();
  });

  it("opens separate YAML tabs for different configmaps", async () => {
    window.localStorage.setItem(
      "dashboard.configuration.watcher.settings.v2:cluster-a:configmaps",
      JSON.stringify({ enabled: false, refreshSeconds: 30, viewMode: "flat" }),
    );

    const { getByLabelText, getByText, getByRole } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            { metadata: { name: "first", namespace: "default" }, data: { "a.json": "{}" } },
            { metadata: { name: "second", namespace: "default" }, data: { "b.json": "{}" } },
          ],
        },
      },
    });

    await fireEvent.click(getByText("first"));
    await fireEvent.click(getByRole("button", { name: "Edit ConfigMap YAML" }));
    expect(getByText("YAML first")).toBeInTheDocument();

    await fireEvent.click(getByText("second"));
    await fireEvent.click(getByRole("button", { name: "Edit ConfigMap YAML" }));
    expect(getByText("YAML first")).toBeInTheDocument();
    expect(getByText("YAML second")).toBeInTheDocument();
  });

  it("renders endpoints with Endpoints column and details", async () => {
    const { getAllByText, getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Endpoints - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "endpoints",
          sort_field: null,
          workloadKey: "endpoints",
          items: [
            {
              metadata: { name: "api", namespace: "default" },
              subsets: [{ addresses: [{ ip: "10.0.0.1" }], ports: [{ port: 443 }] }],
            },
          ],
        },
      },
    });

    expect(getAllByText("Endpoints").length).toBeGreaterThan(0);
    expect(getByText("api")).toBeInTheDocument();
    await fireEvent.click(getByText("api"));
    expect(getByText("Properties")).toBeInTheDocument();
  });

  it("renders endpointslices with readiness and ports columns", () => {
    const { getAllByText, getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "EndpointSlices - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "endpointslices",
          sort_field: null,
          workloadKey: "endpointslices",
          items: [
            {
              metadata: { name: "api-xyz", namespace: "default" },
              endpoints: [{ conditions: { ready: true } }, { conditions: { ready: false } }],
              ports: [{ port: 443 }],
            },
          ],
        },
      },
    });

    expect(getAllByText("Endpoints").length).toBeGreaterThan(0);
    expect(getByText("Ports")).toBeInTheDocument();
    expect(getByText("Status")).toBeInTheDocument();
    expect(getByText("api-xyz")).toBeInTheDocument();
  });

  it("renders ingress classes with controller/api group/scope/kind columns", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Ingress Classes - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "ingressclasses",
          sort_field: null,
          workloadKey: "ingressclasses",
          items: [
            {
              metadata: {
                name: "nginx",
                annotations: { "ingressclass.kubernetes.io/is-default-class": "true" },
              },
              spec: {
                controller: "k8s.io/ingress-nginx",
                parameters: {
                  apiGroup: "networking.k8s.io",
                  scope: "Cluster",
                  kind: "IngressClassParams",
                },
              },
            },
          ],
        },
      },
    });

    expect(getByText("Ingress Classes")).toBeInTheDocument();
    expect(getByText("Controller")).toBeInTheDocument();
    expect(getByText("ApiGroup")).toBeInTheDocument();
    expect(getByText("Scope")).toBeInTheDocument();
    expect(getByText("Kind")).toBeInTheDocument();
    expect(getByText("k8s.io/ingress-nginx")).toBeInTheDocument();
  });

  it("renders access control resources in shared table", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Roles - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "roles",
          sort_field: null,
          workloadKey: "roles",
          items: [
            {
              metadata: { name: "read-only", namespace: "default" },
              rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
            },
          ],
        },
      },
    });

    expect(getByText("Roles")).toBeInTheDocument();
    expect(getByText("read-only")).toBeInTheDocument();
  });

  it("shows RBAC relations block for rolebinding details", async () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Role Bindings - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "rolebindings",
          sort_field: null,
          workloadKey: "rolebindings",
          items: [
            {
              metadata: { name: "rb-read", namespace: "default" },
              roleRef: { kind: "Role", name: "read-only" },
              subjects: [{ kind: "ServiceAccount", namespace: "default", name: "default" }],
            },
          ],
        },
      },
    });

    expect(getByText("Bindings")).toBeInTheDocument();
    expect(getByText("1 -> Role/read-only")).toBeInTheDocument();
    await fireEvent.click(getByText("rb-read"));
    expect(getByText("RBAC Relations")).toBeInTheDocument();
    expect(getByText(/RoleRef: Role\/read-only/)).toBeInTheDocument();
  });

  it("shows RBAC risk badge in table and findings in details", async () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Cluster Roles - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "clusterroles",
          sort_field: null,
          workloadKey: "clusterroles",
          items: [
            {
              metadata: { name: "cluster-admin-like" },
              rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
            },
          ],
        },
      },
    });

    expect(getByText(/Critical |High |Medium /)).toBeInTheDocument();
    await fireEvent.click(getByText("cluster-admin-like"));
    expect(getByText("Risk Findings")).toBeInTheDocument();
  });

  it("shows drift badge when last-applied differs from current spec", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            {
              metadata: {
                name: "drifted-cm",
                namespace: "default",
                annotations: {
                  "kubectl.kubernetes.io/last-applied-configuration": JSON.stringify({
                    spec: { immutable: false },
                  }),
                },
              },
              spec: { immutable: true },
              data: { key: "value" },
            },
          ],
        },
      },
    });

    expect(getByText("Drift")).toBeInTheDocument();
  });

  it("asks confirmation when closing YAML tab from close button", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByText, getByRole, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [{ metadata: { name: "first", namespace: "default" }, data: { "a.json": "{}" } }],
        },
      },
    });

    await fireEvent.click(getByText("first"));
    await fireEvent.click(getByRole("button", { name: "Edit ConfigMap YAML" }));
    expect(getByText("YAML first")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Close YAML first tab" }));
    expect(queryByText("YAML first")).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("asks confirmation before shrinking pane layout when hidden panes contain tabs", async () => {
    window.localStorage.setItem(
      "dashboard.configuration.watcher.settings.v2:cluster-a:configmaps",
      JSON.stringify({ enabled: false, refreshSeconds: 30, viewMode: "flat" }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByLabelText, getByText, getByRole, getByTitle } = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [
            { metadata: { name: "first", namespace: "default" }, data: { "a.json": "{}" } },
            { metadata: { name: "second", namespace: "default" }, data: { "b.json": "{}" } },
          ],
        },
      },
    });

    await fireEvent.click(getByText("first"));
    await fireEvent.click(getByRole("button", { name: "Edit ConfigMap YAML" }));
    await fireEvent.click(getByLabelText("Select default/second"));
    await fireEvent.click(getByRole("button", { name: "Edit YAML" }));
    expect(getByText("YAML first")).toBeInTheDocument();
    expect(getByText("YAML second")).toBeInTheDocument();

    const paneLayout = getByTitle("Pane layout") as HTMLSelectElement;
    paneLayout.value = "dual";
    await fireEvent.change(paneLayout);
    expect(paneLayout.value).toBe("dual");

    paneLayout.value = "single";
    await fireEvent.change(paneLayout);
    expect(confirmSpy).toHaveBeenCalled();
    expect(getByText("Pane 2")).toBeInTheDocument();
  });

  it("renders rows when switching between configuration workloads", async () => {
    window.localStorage.setItem(
      "dashboard.configuration.watcher.settings.v2:cluster-a:configmaps",
      JSON.stringify({ enabled: false, refreshSeconds: 30, viewMode: "flat" }),
    );
    window.localStorage.setItem(
      "dashboard.configuration.watcher.settings.v2:cluster-a:secrets",
      JSON.stringify({ enabled: false, refreshSeconds: 30, viewMode: "flat" }),
    );

    const first = render(ConfigurationList, {
      props: {
        data: {
          title: "ConfigMaps - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "configmaps",
          sort_field: null,
          workloadKey: "configmaps",
          items: [{ metadata: { name: "cm-one", namespace: "default" }, data: { key: "v" } }],
        },
      },
    });

    await first.findByText("cm-one");
    first.unmount();

    const second = render(ConfigurationList, {
      props: {
        data: {
          title: "Secrets - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "secrets",
          sort_field: null,
          workloadKey: "secrets",
          items: [{ metadata: { name: "sec-one", namespace: "default" }, data: { token: "abc" } }],
        },
      },
    });

    expect(await second.findByText("sec-one")).toBeInTheDocument();
  });

  it("shows Type field in Secret details", async () => {
    const { getByText, getAllByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Secrets - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "secrets",
          sort_field: null,
          workloadKey: "secrets",
          items: [
            {
              metadata: { name: "alertmanager-config", namespace: "monitoring" },
              type: "Opaque",
              data: { "alertmanager.yaml": "ZGF0YQ==" },
            },
          ],
        },
      },
    });

    await fireEvent.click(getByText("alertmanager-config"));
    expect(getAllByText("Opaque").length).toBeGreaterThan(0);
    expect(getByText("alertmanager.yaml")).toBeInTheDocument();
  });

  it("uses PriorityClass-specific table columns", () => {
    const { getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Priority Classes - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "priorityclasses",
          sort_field: null,
          workloadKey: "priorityclasses",
          items: [
            {
              metadata: { name: "high-priority", creationTimestamp: "2026-02-17T22:33:46Z" },
              value: 1000000,
              globalDefault: false,
            },
          ],
        },
      },
    });

    expect(getByText("Name")).toBeInTheDocument();
    expect(getByText("Value")).toBeInTheDocument();
    expect(getByText("Global default")).toBeInTheDocument();
    expect(getByText("Age")).toBeInTheDocument();
    expect(queryByText("Namespace")).not.toBeInTheDocument();
    expect(queryByText("Keys")).not.toBeInTheDocument();
  });

  it("uses Namespaces columns with Labels and Status", () => {
    const { getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Namespaces - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "namespaces",
          sort_field: null,
          workloadKey: "namespaces",
          items: [
            {
              metadata: { name: "team-a", labels: { env: "prod", owner: "platform" } },
              status: { phase: "Active" },
            },
          ],
        },
      },
    });

    expect(getByText("Labels")).toBeInTheDocument();
    expect(getByText("Status")).toBeInTheDocument();
    expect(getByText("env=prod, owner=platform")).toBeInTheDocument();
    expect(getByText("Active")).toBeInTheDocument();
    expect(queryByText("RV")).not.toBeInTheDocument();
  });

  it("uses Secrets labels column", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Secrets - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "secrets",
          sort_field: null,
          workloadKey: "secrets",
          items: [
            {
              metadata: { name: "sec-one", namespace: "default", labels: { app: "api" } },
              type: "Opaque",
              data: { token: "abc" },
            },
          ],
        },
      },
    });

    expect(getByText("Labels")).toBeInTheDocument();
    expect(getByText("app=api")).toBeInTheDocument();
  });

  it("uses HPA and PDB requested columns", () => {
    const hpa = render(ConfigurationList, {
      props: {
        data: {
          title: "Horizontal Pod Autoscalers - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "horizontalpodautoscalers",
          sort_field: null,
          workloadKey: "horizontalpodautoscalers",
          items: [
            {
              metadata: { name: "api-hpa", namespace: "default" },
              spec: { minReplicas: 2, maxReplicas: 6, metrics: [{ type: "Resource" }] },
              status: { currentReplicas: 2, desiredReplicas: 4 },
            },
          ],
        },
      },
    });

    expect(hpa.getByText("Metrics")).toBeInTheDocument();
    expect(hpa.getByText("Min Pods")).toBeInTheDocument();
    expect(hpa.getByText("Max Pods")).toBeInTheDocument();
    expect(hpa.getByText("Replicas")).toBeInTheDocument();
    expect(hpa.getByText("Status")).toBeInTheDocument();
    expect(hpa.getByText("2/4")).toBeInTheDocument();
    expect(hpa.getByText("Scaling up")).toBeInTheDocument();
    hpa.unmount();

    const pdb = render(ConfigurationList, {
      props: {
        data: {
          title: "Pod Disruption Budgets - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "poddisruptionbudgets",
          sort_field: null,
          workloadKey: "poddisruptionbudgets",
          items: [
            {
              metadata: { name: "api-pdb", namespace: "default" },
              spec: { minAvailable: 1, maxUnavailable: "25%" },
              status: { currentHealthy: 3, desiredHealthy: 2 },
            },
          ],
        },
      },
    });

    expect(pdb.getByText("Min available")).toBeInTheDocument();
    expect(pdb.getByText("Max unavailable")).toBeInTheDocument();
    expect(pdb.getByText("Current healthy")).toBeInTheDocument();
    expect(pdb.getByText("Desired healthy")).toBeInTheDocument();
    expect(pdb.getByText("25%")).toBeInTheDocument();
  });

  it("supports Network workloads (Services) with details + YAML actions", async () => {
    const { getAllByText, getByText, getByRole, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Services - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "services",
          sort_field: null,
          workloadKey: "services",
          items: [
            {
              metadata: { name: "kube-dns", namespace: "kube-system" },
              spec: {
                type: "ClusterIP",
                ports: [{ port: 53 }],
                externalIPs: ["192.168.49.11"],
                selector: { "k8s-app": "kube-dns" },
              },
            },
          ],
        },
      },
    });

    expect(getByText("Services")).toBeInTheDocument();
    expect(queryByText("Keys")).not.toBeInTheDocument();
    expect(getAllByText("External IP").length).toBeGreaterThan(0);
    expect(getAllByText("Selector").length).toBeGreaterThan(0);
    expect(getAllByText("Status").length).toBeGreaterThan(0);
    expect(getAllByText("Ports").length).toBeGreaterThan(0);
    await fireEvent.click(getByText("kube-dns"));
    expect(getByRole("button", { name: "Edit Service YAML" })).toBeInTheDocument();
  });

  it("supports Storage workloads (PersistentVolumes) with cluster-scoped columns", () => {
    const { getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Persistent Volumes - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "persistentvolumes",
          sort_field: null,
          workloadKey: "persistentvolumes",
          items: [
            {
              metadata: { name: "pv-local-001", creationTimestamp: "2026-02-17T22:33:46Z" },
              status: { phase: "Bound" },
              spec: {
                capacity: { storage: "10Gi" },
                storageClassName: "standard",
                claimRef: { namespace: "default", name: "data-app" },
              },
            },
          ],
        },
      },
    });

    expect(getByText("Persistent Volumes")).toBeInTheDocument();
    expect(getByText("pv-local-001")).toBeInTheDocument();
    expect(getByText("Storage Class")).toBeInTheDocument();
    expect(getByText("Capacity")).toBeInTheDocument();
    expect(getByText("Claim")).toBeInTheDocument();
    expect(getByText("Status")).toBeInTheDocument();
    expect(queryByText("Namespace")).not.toBeInTheDocument();
  });

  it("renders CRD, Ingress and NetworkPolicy requested columns", () => {
    const crd = render(ConfigurationList, {
      props: {
        data: {
          title: "Custom Resource Definitions - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "customresourcedefinitions",
          sort_field: null,
          workloadKey: "customresourcedefinitions",
          items: [
            {
              metadata: { name: "widgets.example.com" },
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
    expect(crd.getByText("Resource")).toBeInTheDocument();
    expect(crd.getByText("Group")).toBeInTheDocument();
    expect(crd.getByText("Version")).toBeInTheDocument();
    expect(crd.getByText("Scope")).toBeInTheDocument();
    expect(crd.getByText("widgets")).toBeInTheDocument();
    crd.unmount();

    const ingress = render(ConfigurationList, {
      props: {
        data: {
          title: "Ingresses - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "ingresses",
          sort_field: null,
          workloadKey: "ingresses",
          items: [
            {
              metadata: { name: "web", namespace: "default" },
              spec: { rules: [{ host: "example.local" }] },
              status: { loadBalancer: { ingress: [{ ip: "10.0.0.10" }] } },
            },
          ],
        },
      },
    });
    expect(ingress.getByText("LoadBalancers")).toBeInTheDocument();
    expect(ingress.getByText("Rules")).toBeInTheDocument();
    expect(ingress.getByText("10.0.0.10")).toBeInTheDocument();
    ingress.unmount();

    const netpol = render(ConfigurationList, {
      props: {
        data: {
          title: "Network Policies - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "networkpolicies",
          sort_field: null,
          workloadKey: "networkpolicies",
          items: [
            {
              metadata: { name: "deny-all", namespace: "default" },
              spec: { policyTypes: ["Ingress"] },
            },
          ],
        },
      },
    });
    expect(netpol.getByText("Policy Types")).toBeInTheDocument();
    expect(netpol.getByText("Ingress")).toBeInTheDocument();
  });

  it("renders PVC requested columns", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Persistent Volume Claims - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "persistentvolumeclaims",
          sort_field: null,
          workloadKey: "persistentvolumeclaims",
          items: [
            {
              metadata: { name: "data-app", namespace: "default" },
              spec: { storageClassName: "standard", resources: { requests: { storage: "5Gi" } } },
              status: { phase: "Bound" },
            },
          ],
        },
      },
    });
    expect(getByText("Storage Class")).toBeInTheDocument();
    expect(getByText("Size")).toBeInTheDocument();
    expect(getByText("Pods")).toBeInTheDocument();
    expect(getByText("Status")).toBeInTheDocument();
    expect(getByText("5Gi")).toBeInTheDocument();
  });

  it("shows Unbound quick filter option for PVCs", async () => {
    const { queryByLabelText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Persistent Volume Claims - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "persistentvolumeclaims",
          sort_field: null,
          workloadKey: "persistentvolumeclaims",
          items: [
            {
              metadata: { name: "pvc-bound", namespace: "default" },
              status: { phase: "Bound" },
              spec: { resources: { requests: { storage: "1Gi" } } },
            },
          ],
        },
      },
    });

    expect(queryByLabelText("Quick filter")).not.toBeInTheDocument();
    expect(queryByText("Unbound")).not.toBeInTheDocument();
  });

  it("shows Default class quick filter option for StorageClasses", async () => {
    const { queryByLabelText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Storage Classes - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "storageclasses",
          sort_field: null,
          workloadKey: "storageclasses",
          items: [
            {
              metadata: {
                name: "standard",
                annotations: { "storageclass.kubernetes.io/is-default-class": "true" },
              },
              provisioner: "k8s.io/minikube-hostpath",
            },
            {
              metadata: { name: "slow" },
              provisioner: "example.com/slow",
            },
          ],
        },
      },
    });

    expect(queryByLabelText("Quick filter")).not.toBeInTheDocument();
    expect(queryByText("Default class")).not.toBeInTheDocument();
  });

  it("renders volume attributes classes with driver column", () => {
    const { getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Volume Attributes Classes - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "volumeattributesclasses",
          sort_field: null,
          workloadKey: "volumeattributesclasses",
          items: [
            {
              metadata: { name: "gp3-tuned" },
              spec: { driverName: "ebs.csi.aws.com", parameters: { type: "gp3" } },
            },
          ],
        },
      },
    });

    expect(getByText("Driver")).toBeInTheDocument();
    expect(getByText("gp3-tuned")).toBeInTheDocument();
    expect(getByText("ebs.csi.aws.com")).toBeInTheDocument();
  });

  it("renders volume snapshots with snapshot class, size, and status", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Volume Snapshots - Cluster: minikube",
          slug: "minikube",
          workload: "volumesnapshots",
          sort_field: null,
          workloadKey: "volumesnapshots",
          items: [
            {
              metadata: { name: "snap-a", namespace: "apps" },
              spec: { volumeSnapshotClassName: "csi-snap" },
              status: { readyToUse: true, restoreSize: "5Gi" },
            },
          ],
        },
      },
    });

    expect(getByText("Snapshot Class")).toBeInTheDocument();
    expect(getByText("Restore Size")).toBeInTheDocument();
    expect(getByText("Status")).toBeInTheDocument();
    expect(getByText("csi-snap")).toBeInTheDocument();
    expect(getByText("5Gi")).toBeInTheDocument();
  });

  it("renders volume snapshot contents with snapshot ref and deletion policy", () => {
    const { getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Volume Snapshot Contents - Cluster: minikube",
          slug: "minikube",
          workload: "volumesnapshotcontents",
          sort_field: null,
          workloadKey: "volumesnapshotcontents",
          items: [
            {
              metadata: { name: "snapcontent-a" },
              spec: {
                driver: "ebs.csi.aws.com",
                deletionPolicy: "Delete",
                volumeSnapshotRef: { namespace: "apps", name: "snap-a" },
              },
              status: { readyToUse: true, restoreSize: "5Gi" },
            },
          ],
        },
      },
    });

    expect(getByText("Snapshot Ref")).toBeInTheDocument();
    expect(getByText("Deletion Policy")).toBeInTheDocument();
    expect(getByText("Driver")).toBeInTheDocument();
    expect(getByText("apps/snap-a")).toBeInTheDocument();
    expect(queryByText("Namespace")).not.toBeInTheDocument();
  });

  it("renders volume snapshot classes with default and deletion policy", () => {
    const { getByText, queryByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Volume Snapshot Classes - Cluster: minikube",
          slug: "minikube",
          workload: "volumesnapshotclasses",
          sort_field: null,
          workloadKey: "volumesnapshotclasses",
          items: [
            {
              metadata: {
                name: "csi-snap",
                annotations: { "snapshot.storage.kubernetes.io/is-default-class": "true" },
              },
              driver: "ebs.csi.aws.com",
              deletionPolicy: "Delete",
            },
          ],
        },
      },
    });

    expect(getByText("Driver")).toBeInTheDocument();
    expect(getByText("Deletion Policy")).toBeInTheDocument();
    expect(getByText("Default")).toBeInTheDocument();
    expect(queryByText("Namespace")).not.toBeInTheDocument();
  });

  it("renders csi storage capacities with storage class and capacity", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "CSI Storage Capacities - Cluster: minikube",
          slug: "minikube",
          workload: "csistoragecapacities",
          sort_field: null,
          workloadKey: "csistoragecapacities",
          items: [
            {
              metadata: { name: "zone-a-fast", namespace: "kube-system" },
              storageClassName: "fast",
              maximumVolumeSize: "100Gi",
            },
          ],
        },
      },
    });

    expect(getByText("Storage Class")).toBeInTheDocument();
    expect(getByText("Capacity")).toBeInTheDocument();
    expect(getByText("fast")).toBeInTheDocument();
    expect(getByText("100Gi")).toBeInTheDocument();
  });

  it("renders namespace lifecycle controls", () => {
    const { getByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Namespaces - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "namespaces",
          sort_field: null,
          workloadKey: "namespaces",
          items: [],
        },
      },
    });

    expect(getByText("Namespace lifecycle")).toBeInTheDocument();
  });

  it("prevents deleting protected namespaces", async () => {
    const { getByText, getByRole, findByText } = render(ConfigurationList, {
      props: {
        data: {
          title: "Namespaces - Cluster: minikube",
          slug: "minikube",
          uuid: "cluster-a",
          workload: "namespaces",
          sort_field: null,
          workloadKey: "namespaces",
          items: [{ metadata: { name: "kube-system" }, status: { phase: "Active" } }],
        },
      },
    });

    vi.mocked(kubectlProxy.kubectlRawArgsFront).mockClear();
    await fireEvent.click(getByText("kube-system"));
    await fireEvent.click(getByRole("button", { name: "Delete Namespace" }));

    expect(await findByText(/protected and cannot be deleted/i)).toBeInTheDocument();
    expect(
      vi
        .mocked(kubectlProxy.kubectlRawArgsFront)
        .mock.calls.some((call) => Array.isArray(call[0]) && call[0][0] === "delete"),
    ).toBe(false);
  });
});
