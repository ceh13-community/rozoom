import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import WorkloadSelectionBar from "./workload-selection-bar.svelte";

describe("WorkloadSelectionBar", () => {
  it("renders a consistent selected-items summary", () => {
    const { getByText } = render(WorkloadSelectionBar, { count: 2 });

    expect(getByText("2 selected")).toBeInTheDocument();
  });
});
