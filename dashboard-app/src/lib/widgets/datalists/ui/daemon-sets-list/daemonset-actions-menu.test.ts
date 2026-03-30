import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DaemonSetActionsMenu from "./daemonset-actions-menu.svelte";

describe("DaemonSetActionsMenu", () => {
  it("renders trigger button", () => {
    const { getByRole } = render(DaemonSetActionsMenu, {
      props: {
        name: "aws-node",
        namespace: "kube-system",
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onRolloutStatus: vi.fn(),
        onRolloutHistory: vi.fn(),
        onRestart: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for aws-node" })).toBeInTheDocument();
  });

  it("disables trigger when busy", () => {
    const { getByRole } = render(DaemonSetActionsMenu, {
      props: {
        name: "aws-node",
        namespace: "kube-system",
        isBusy: true,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onEvents: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onRolloutStatus: vi.fn(),
        onRolloutHistory: vi.fn(),
        onRestart: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Open actions for aws-node" })).toBeDisabled();
  });
});
