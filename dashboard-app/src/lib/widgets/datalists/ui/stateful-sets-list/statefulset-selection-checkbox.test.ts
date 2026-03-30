import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import StatefulSetSelectionCheckbox from "./statefulset-selection-checkbox.svelte";

describe("StatefulSetSelectionCheckbox", () => {
  it("renders checkbox and forwards checked state", () => {
    const { getByRole } = render(StatefulSetSelectionCheckbox, {
      props: {
        checked: true,
        indeterminate: false,
        label: "Select all stateful sets",
        onToggle: vi.fn(),
      },
    });
    const checkbox = getByRole("checkbox", {
      name: "Select all stateful sets",
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("sets aria-checked to mixed for indeterminate state", () => {
    const { getByRole } = render(StatefulSetSelectionCheckbox, {
      props: {
        checked: false,
        indeterminate: true,
        label: "Select namespace apps",
        onToggle: vi.fn(),
      },
    });
    const checkbox = getByRole("checkbox", { name: "Select namespace apps" });
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  });
});
