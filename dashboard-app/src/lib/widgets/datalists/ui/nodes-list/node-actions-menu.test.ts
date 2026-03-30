import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import NodeActionsMenu from "./node-actions-menu.svelte";

describe("NodeActionsMenu", () => {
  it("renders action trigger with node context", () => {
    const { getByRole } = render(NodeActionsMenu, {
      props: {
        name: "worker-1",
        isUnschedulable: false,
        isCordoning: false,
        isDraining: false,
        isDeleting: false,
        onShowDetails: vi.fn(),
        onTopNode: vi.fn(),
        onEvents: vi.fn(),
        onShell: vi.fn(),
        onToggleCordon: vi.fn(),
        onDrain: vi.fn(),
        onEditYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for worker-1" })).toBeInTheDocument();
  });

  it("keeps trigger enabled while actions are idle", () => {
    const { getByRole } = render(NodeActionsMenu, {
      props: {
        name: "worker-1",
        isUnschedulable: false,
        isCordoning: false,
        isDraining: false,
        isDeleting: false,
        onShowDetails: vi.fn(),
        onTopNode: vi.fn(),
        onEvents: vi.fn(),
        onShell: vi.fn(),
        onToggleCordon: vi.fn(),
        onDrain: vi.fn(),
        onEditYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for worker-1" })).not.toHaveAttribute(
      "disabled",
    );
  });
});
