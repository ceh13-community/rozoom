import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ReplicaSetSelectionCheckbox from "./replicaset-selection-checkbox.svelte";

describe("ReplicaSetSelectionCheckbox", () => {
  it("renders checkbox and forwards checked state", () => {
    const { getByRole } = render(ReplicaSetSelectionCheckbox, {
      props: {
        checked: true,
        indeterminate: false,
        label: "Select all replica sets",
        onToggle: vi.fn(),
      },
    });
    const checkbox = getByRole("checkbox", { name: "Select all replica sets" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("sets aria-checked to mixed for indeterminate state", () => {
    const { getByRole } = render(ReplicaSetSelectionCheckbox, {
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
