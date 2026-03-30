import { fireEvent, render } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccessReviewsPanel from "./access-reviews-panel.svelte";

type Subscriber<T> = (value: T) => void;

function createStore<T>(initial: T) {
  let value = initial;
  const subscribers = new Set<Subscriber<T>>();
  return {
    set(next: T) {
      value = next;
      for (const subscriber of subscribers) subscriber(value);
    },
    subscribe(subscriber: Subscriber<T>) {
      subscriber(value);
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}

const mockNamespace = vi.hoisted(() => createStore("default"));
const mockKubectlRawArgsFront = vi.hoisted(() => vi.fn());

vi.mock("$features/namespace-management", () => ({
  selectedNamespace: mockNamespace,
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: mockKubectlRawArgsFront,
}));

describe("access-reviews-panel", () => {
  beforeEach(() => {
    mockNamespace.set("default");
    mockKubectlRawArgsFront.mockReset();
    mockKubectlRawArgsFront.mockResolvedValue({ output: "yes", errors: "", code: 0 });
  });

  it("runs kubectl auth can-i and renders result", async () => {
    const { getByRole, findByText } = render(AccessReviewsPanel, {
      props: {
        data: {
          title: "Access Reviews - Cluster: minikube",
          slug: "cluster-a",
          workload: "accessreviews",
          sort_field: null,
        },
      },
    });

    await fireEvent.click(getByRole("button", { name: "Can I?" }));

    expect(mockKubectlRawArgsFront).toHaveBeenCalledWith(
      ["auth", "can-i", "get", "pods", "-n", "default"],
      { clusterId: "cluster-a" },
    );
    expect(await findByText("yes")).toBeInTheDocument();
  });
});
