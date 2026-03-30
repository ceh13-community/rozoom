import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CronJobActionsMenu from "./cronjob-actions-menu.svelte";

describe("CronJobActionsMenu", () => {
  it("renders trigger button", () => {
    const { getByRole } = render(CronJobActionsMenu, {
      props: {
        name: "nightly-backup",
        namespace: "default",
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onTrigger: vi.fn(),
        onToggleSuspend: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for nightly-backup" })).toBeInTheDocument();
  });

  it("disables trigger when busy", () => {
    const { getByRole } = render(CronJobActionsMenu, {
      props: {
        name: "nightly-backup",
        namespace: "default",
        isBusy: true,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onTrigger: vi.fn(),
        onToggleSuspend: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Open actions for nightly-backup" })).toBeDisabled();
  });
});
