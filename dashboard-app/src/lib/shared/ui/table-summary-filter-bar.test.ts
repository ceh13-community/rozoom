import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TableSummaryFilterBar from "./table-summary-filter-bar.svelte";

describe("TableSummaryFilterBar", () => {
  it("renders summary items and forwards filter input changes", async () => {
    const onInput = vi.fn();
    const { getByText, getByPlaceholderText } = render(TableSummaryFilterBar, {
      items: [
        { label: "Cluster", value: "minikube" },
        { label: "Rows", value: 12 },
      ],
      value: "svc",
      placeholder: "Filter services...",
      onInput,
    });

    expect(getByText("Cluster:")).toBeInTheDocument();
    expect(getByText("minikube")).toBeInTheDocument();
    expect(getByText("Rows:")).toBeInTheDocument();
    expect(getByText("12")).toBeInTheDocument();

    const input = getByPlaceholderText("Filter services...") as HTMLInputElement;
    expect(input.value).toBe("svc");

    await fireEvent.input(input, { target: { value: "gateway" } });

    expect(onInput).toHaveBeenCalledWith("gateway");
  });
});
