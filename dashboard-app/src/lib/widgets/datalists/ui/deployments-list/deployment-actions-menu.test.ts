import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DeploymentActionsMenu from "./deployment-actions-menu.svelte";

describe("DeploymentActionsMenu", () => {
  it("renders action trigger with deployment context", () => {
    const { getByRole } = render(DeploymentActionsMenu, {
      props: {
        name: "api",
        namespace: "prod",
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
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

    const trigger = getByRole("button", { name: "Open actions for api" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("title", "Actions: prod/api");
    expect(trigger).not.toHaveAttribute("disabled");
  });

  it("disables trigger when menu is disabled", () => {
    const { getByRole } = render(DeploymentActionsMenu, {
      props: {
        name: "api",
        namespace: "prod",
        disabled: true,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
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

    expect(getByRole("button", { name: "Open actions for api" })).toBeDisabled();
  });
});
