import { fireEvent, render, waitFor } from "@testing-library/svelte";
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

  it("has no empty section: Diagnostics holds Top node, Events and Shell", async () => {
    const { getByRole, findByText, getAllByRole } = render(NodeActionsMenu, {
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
    const trigger = getByRole("button", { name: "Open actions for worker-1" });
    await fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    await fireEvent.click(trigger);
    const diagnostics = await findByText("Diagnostics");
    await waitFor(() => expect(getAllByRole("menuitem").length).toBeGreaterThan(3));
    const items = getAllByRole("menuitem").map((item) => item.textContent?.trim() ?? "");
    const order = (label: string) => items.findIndex((text) => text.startsWith(label));
    expect(diagnostics).toBeInTheDocument();
    expect(order("Top node")).toBeGreaterThan(-1);
    expect(order("Shell")).toBeGreaterThan(order("Events"));
    expect(items.some((text) => text.includes("via SSH"))).toBe(false);
  });
});
