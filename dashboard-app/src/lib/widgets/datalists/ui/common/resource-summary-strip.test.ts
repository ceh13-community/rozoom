import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ResourceSummaryStrip from "./resource-summary-strip.svelte";

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
});
