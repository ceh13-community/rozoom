import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CronJobBulkActions from "./cronjob-bulk-actions.svelte";

describe("CronJobBulkActions", () => {
  it("shows trigger action in single mode and triggers callback", async () => {
    const onTrigger = vi.fn();
    const { getByRole } = render(CronJobBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onTrigger,
        onToggleSuspend: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Trigger cron job now" }));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("shows investigate action in single mode and triggers callback", async () => {
    const onInvestigate = vi.fn();
    const { getByRole } = render(CronJobBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate,
        onTrigger: vi.fn(),
        onToggleSuspend: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Investigate cron job" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });
});
