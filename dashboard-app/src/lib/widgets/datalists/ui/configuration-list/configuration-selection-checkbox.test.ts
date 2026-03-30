import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConfigurationSelectionCheckbox from "./configuration-selection-checkbox.svelte";

describe("configuration-selection-checkbox", () => {
  it("renders checkbox and forwards checked state", async () => {
    const onToggle = vi.fn();
    const { getByRole } = render(ConfigurationSelectionCheckbox, {
      props: {
        checked: false,
        label: "Select row",
        onToggle,
      },
    });

    const checkbox = getByRole("checkbox", { name: "Select row" });
    await fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
