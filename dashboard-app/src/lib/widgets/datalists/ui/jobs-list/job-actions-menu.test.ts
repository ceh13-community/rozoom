import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import JobActionsMenu from "./job-actions-menu.svelte";

describe("JobActionsMenu", () => {
  it("renders trigger button", () => {
    const { getByRole } = render(JobActionsMenu, {
      props: {
        name: "backup-job",
        namespace: "default",
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for backup-job" })).toBeInTheDocument();
  });

  it("disables trigger when busy", () => {
    const { getByRole } = render(JobActionsMenu, {
      props: {
        name: "backup-job",
        namespace: "default",
        isBusy: true,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Open actions for backup-job" })).toBeDisabled();
  });
});
