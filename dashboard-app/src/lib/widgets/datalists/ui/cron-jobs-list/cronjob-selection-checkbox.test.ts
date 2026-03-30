import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CronJobSelectionCheckbox from "./cronjob-selection-checkbox.svelte";

describe("CronJobSelectionCheckbox", () => {
  it("renders checkbox and forwards checked state", () => {
    const { getByRole } = render(CronJobSelectionCheckbox, {
      props: {
        checked: true,
        indeterminate: false,
        label: "Select all cron jobs",
        onToggle: vi.fn(),
      },
    });
    const checkbox = getByRole("checkbox", { name: "Select all cron jobs" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("sets aria-checked to mixed for indeterminate state", () => {
    const { getByRole } = render(CronJobSelectionCheckbox, {
      props: {
        checked: false,
        indeterminate: true,
        label: "Select namespace ops",
        onToggle: vi.fn(),
      },
    });
    const checkbox = getByRole("checkbox", { name: "Select namespace ops" });
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  });
});
