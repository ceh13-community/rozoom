import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedNamespace } from "$features/namespace-management";

// The whole PodsList is mounted: DataTable reports the ids it can show, and the
// parent prunes its selection to them. Only the edges (kubectl, the snapshot
// fetch, the pods watcher) are stubbed. Pods arrive through the snapshot fetch,
// as in the app: no route passes data.pods.
const { pods, kubectlRawFront } = vi.hoisted(() => {
  const makePod = (name: string, namespace: string) => ({
    metadata: { name, namespace, uid: `${namespace}-${name}-uid` },
    spec: { nodeName: "node-1", containers: [{ name: "app", image: "app:1" }] },
    status: {
      phase: "Running",
      containerStatuses: [{ name: "app", ready: true, restartCount: 0 }],
    },
  });
  return {
    pods: [makePod("api-0", "team-a"), makePod("worker-0", "team-b")],
    kubectlRawFront: vi.fn(async (_command: string, _options?: unknown) => ({
      output: "",
      errors: "",
    })),
  };
});

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront,
  kubectlRawArgsFront: vi.fn(async () => ({ output: "", errors: "" })),
}));

vi.mock("../common/namespaced-snapshot", () => ({
  fetchNamespacedSnapshotItems: vi.fn(async () => pods),
}));

vi.mock("$features/check-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$features/check-health")>();
  return {
    ...actual,
    initPodsSync: vi.fn(),
    destroyPodsSync: vi.fn(),
    setPodsSyncEnabled: vi.fn(),
  };
});

vi.mock("$features/metrics-sources", () => ({
  runMetricsSourcesCheck: vi.fn(async () => []),
}));

import PodsList from "./pods-list.svelte";

function renderPodsList() {
  return render(PodsList, {
    props: {
      data: {
        slug: "cluster-a",
        title: "Pods - Cluster: cluster-a",
      } as never,
    },
  });
}

function deletedCommands() {
  return kubectlRawFront.mock.calls
    .map((call) => String(call[0]))
    .filter((command) => command.startsWith("delete pod"));
}

describe("pods list selection and the namespace filter", () => {
  beforeEach(() => {
    selectedNamespace.set("all");
    kubectlRawFront.mockClear();
  });

  afterEach(() => {
    selectedNamespace.set("all");
  });

  it("drops a selected pod from the bulk delete once its namespace is unchecked", async () => {
    const { getByLabelText, getByRole, findByText, queryByLabelText, queryByText } =
      renderPodsList();

    await fireEvent.click(await waitFor(() => getByLabelText("Select pod api-0")));
    await fireEvent.click(getByLabelText("Select pod worker-0"));
    expect(await findByText("2 selected")).toBeInTheDocument();

    selectedNamespace.set("team-a");
    await tick();

    await waitFor(() => expect(queryByLabelText("Select pod worker-0")).toBeNull());
    expect(await findByText("1 selected")).toBeInTheDocument();
    expect(queryByText("2 selected")).toBeNull();

    await fireEvent.click(getByLabelText("Delete selected pods"));
    await fireEvent.click(await waitFor(() => getByRole("button", { name: "Confirm delete" })));

    await waitFor(() => expect(deletedCommands()).toEqual(["delete pod api-0 -n team-a"]));
  });

  it("keeps the hidden pod out of the selection when its namespace comes back", async () => {
    const { getByLabelText, findByText } = renderPodsList();

    await fireEvent.click(await waitFor(() => getByLabelText("Select pod worker-0")));
    expect(await findByText("1 selected")).toBeInTheDocument();

    selectedNamespace.set("team-a");
    await tick();
    selectedNamespace.set("all");
    await tick();

    const checkbox = await waitFor(() => getByLabelText("Select pod worker-0") as HTMLInputElement);
    expect(checkbox.checked).toBe(false);
  });

  it("Select all under a namespace filter reaches only the pods on screen", async () => {
    selectedNamespace.set("team-a");
    const { getByLabelText, getByRole, findByText } = renderPodsList();

    await fireEvent.click(await waitFor(() => getByLabelText("Select all pods")));
    expect(await findByText("1 selected")).toBeInTheDocument();

    await fireEvent.click(getByLabelText("Delete selected pods"));
    await fireEvent.click(await waitFor(() => getByRole("button", { name: "Confirm delete" })));

    await waitFor(() => expect(deletedCommands()).toEqual(["delete pod api-0 -n team-a"]));
  });
});
