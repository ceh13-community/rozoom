import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import JobSelectionCheckbox from "./job-selection-checkbox.svelte";

describe("JobSelectionCheckbox", () => {
  it("renders checkbox and forwards checked state", () => {
    const { getByRole } = render(JobSelectionCheckbox, {
      props: {
        checked: true,
        indeterminate: false,
        label: "Select all jobs",
        onToggle: vi.fn(),
      },
    });
    const checkbox = getByRole("checkbox", { name: "Select all jobs" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("sets aria-checked to mixed for indeterminate state", () => {
    const { getByRole } = render(JobSelectionCheckbox, {
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
