import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ReplicaSetBulkActions from "./replicaset-bulk-actions.svelte";

describe("ReplicaSetBulkActions", () => {
  it("shows investigate action in single mode and triggers callback", async () => {
    const onInvestigate = vi.fn();
    const { getByRole } = render(ReplicaSetBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onScale: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate,
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Investigate replica set" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });
});
