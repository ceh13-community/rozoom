import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import NodeBulkActions from "./node-bulk-actions.svelte";

describe("NodeBulkActions", () => {
  it("renders top node and events actions for single selection", () => {
    const { getByRole } = render(NodeBulkActions, {
      props: {
        mode: "single",
        canOpenShell: true,
        canEditYaml: true,
        isCordoning: false,
        isDraining: false,
        isDeleting: false,
        isUnschedulableSelection: false,
        onTopNode: vi.fn(),
        onEvents: vi.fn(),
        onShell: vi.fn(),
        onToggleCordon: vi.fn(),
        onDrain: vi.fn(),
        onEditYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Top node" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Events" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Edit YAML" })).toBeInTheDocument();
  });
});
