import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import StatefulSetBulkActions from "./statefulset-bulk-actions.svelte";

describe("StatefulSetBulkActions", () => {
  it("shows investigate action in single mode and triggers callback", async () => {
    const onInvestigate = vi.fn();
    const { getByRole } = render(StatefulSetBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onScale: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate,
        onRolloutStatus: vi.fn(),
        onRolloutHistory: vi.fn(),
        onDownloadYaml: vi.fn(),
        onRestart: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Investigate stateful set" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });
});
