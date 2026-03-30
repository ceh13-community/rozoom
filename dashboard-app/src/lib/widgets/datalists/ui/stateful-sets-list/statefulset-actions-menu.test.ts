import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import StatefulSetActionsMenu from "./statefulset-actions-menu.svelte";

describe("StatefulSetActionsMenu", () => {
  it("renders trigger button", () => {
    const { getByRole } = render(StatefulSetActionsMenu, {
      props: {
        name: "postgres",
        namespace: "default",
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onScale: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onRolloutStatus: vi.fn(),
        onRolloutHistory: vi.fn(),
        onRestart: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for postgres" })).toBeInTheDocument();
  });

  it("disables trigger when busy", () => {
    const { getByRole } = render(StatefulSetActionsMenu, {
      props: {
        name: "postgres",
        namespace: "default",
        isBusy: true,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onScale: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onRolloutStatus: vi.fn(),
        onRolloutHistory: vi.fn(),
        onRestart: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Open actions for postgres" })).toBeDisabled();
  });
});
