import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DaemonSetSelectionCheckbox from "./daemonset-selection-checkbox.svelte";

describe("DaemonSetSelectionCheckbox", () => {
  it("renders checkbox and triggers onToggle", async () => {
    const onToggle = vi.fn();
    const { getByRole } = render(DaemonSetSelectionCheckbox, {
      props: {
        checked: false,
        label: "Select daemon set",
        onToggle,
      },
    });

    const checkbox = getByRole("checkbox", { name: "Select daemon set" });
    await fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("sets mixed aria state for indeterminate", () => {
    const { getByRole } = render(DaemonSetSelectionCheckbox, {
      props: {
        checked: false,
        indeterminate: true,
        label: "Select group",
        onToggle: () => {},
      },
    });
    expect(getByRole("checkbox", { name: "Select group" })).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
  });
});
