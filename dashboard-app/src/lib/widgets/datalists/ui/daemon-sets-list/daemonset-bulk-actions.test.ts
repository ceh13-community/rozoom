import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DaemonSetBulkActions from "./daemonset-bulk-actions.svelte";

describe("DaemonSetBulkActions", () => {
  it("shows investigate action in single mode and triggers callback", async () => {
    const onInvestigate = vi.fn();
    const { getByRole } = render(DaemonSetBulkActions, {
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
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Investigate daemon set" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });
});
