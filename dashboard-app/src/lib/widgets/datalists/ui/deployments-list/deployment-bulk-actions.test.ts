import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DeploymentBulkActions from "./deployment-bulk-actions.svelte";

describe("DeploymentBulkActions", () => {
  it("shows investigate action in single mode and triggers callback", async () => {
    const onInvestigate = vi.fn();
    const { getByRole } = render(DeploymentBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate,
        onRolloutStatus: vi.fn(),
        onRolloutHistory: vi.fn(),
        onDownloadYaml: vi.fn(),
        onRestart: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
        onUndo: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Investigate deployment" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });
});
