import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import JobBulkActions from "./job-bulk-actions.svelte";

describe("JobBulkActions", () => {
  it("shows investigate action in single mode and triggers callback", async () => {
    const onInvestigate = vi.fn();
    const { getByRole } = render(JobBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate,
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Investigate job" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });
});
