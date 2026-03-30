import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TableChecklistDropdown from "./table-checklist-dropdown.svelte";

describe("table-checklist-dropdown", () => {
  it("opens checklist, toggles items, and supports select/clear all", async () => {
    const onToggle = vi.fn();
    const onSelectAll = vi.fn();
    const onClearAll = vi.fn();

    const { getByRole, getByLabelText } = render(TableChecklistDropdown, {
      props: {
        label: "NS (1/2)",
        entries: [
          { id: "default", label: "default", checked: true },
          { id: "kube-system", label: "kube-system", checked: false },
        ],
        onToggle,
        onSelectAll,
        onClearAll,
      },
    });

    await fireEvent.click(getByRole("button", { name: "NS (1/2)" }));
    await waitFor(() => {
      expect(getByRole("button", { name: "All" })).toBeInTheDocument();
    });

    await fireEvent.click(getByRole("button", { name: "All" }));
    await fireEvent.click(getByRole("button", { name: "None" }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearAll).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByLabelText("kube-system"));
    expect(onToggle).toHaveBeenCalledWith("kube-system", true);
  });
});
