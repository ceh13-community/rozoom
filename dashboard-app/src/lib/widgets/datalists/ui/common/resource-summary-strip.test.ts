import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ResourceSummaryStrip from "./resource-summary-strip.svelte";
import { LIST_FRESHNESS_CONTEXT } from "./list-freshness-context.svelte";

describe("resource summary strip", () => {
  it("renders leading items and trailing item with shared layout", () => {
    const { getByText } = render(ResourceSummaryStrip, {
      props: {
        items: [
          { label: "Cluster", value: "minikube", tone: "foreground" },
          { label: "Namespace", value: "all" },
          { label: "Pods", value: 26 },
        ],
        trailingItem: {
          label: "View",
          value: "Enriched",
          tone: "default",
          valueClass: "text-foreground",
        },
      },
    });

    expect(getByText("Cluster:")).toBeInTheDocument();
    expect(getByText("minikube")).toBeInTheDocument();
    expect(getByText("Namespace:")).toBeInTheDocument();
    expect(getByText("all")).toBeInTheDocument();
    expect(getByText("Pods:")).toBeInTheDocument();
    expect(getByText("26")).toBeInTheDocument();
    expect(getByText("View:")).toBeInTheDocument();
    expect(getByText("Enriched")).toBeInTheDocument();
  });

  it("shows the list's one freshness indicator in the same row as the counts", () => {
    const { getByTestId, getByText } = render(ResourceSummaryStrip, {
      props: { items: [{ label: "Pods", value: 30 }] },
      context: new Map([
        [
          LIST_FRESHNESS_CONTEXT,
          { state: "live", mode: "stream", updatedAt: Date.now() - 180_000, watcherEnabled: true },
        ],
      ]),
    });
    const indicator = getByTestId("list-freshness");
    expect(indicator).toHaveTextContent("Live");
    expect(indicator).toHaveAttribute(
      "title",
      "Changes appear as they happen. Last change 3m ago.",
    );
    expect(indicator.parentElement).toBe(getByText("Pods:").parentElement);
  });

  it("shows no indicator outside a list", () => {
    const { queryByTestId } = render(ResourceSummaryStrip, {
      props: { items: [{ label: "Pods", value: 30 }] },
    });
    expect(queryByTestId("list-freshness")).not.toBeInTheDocument();
  });
});
