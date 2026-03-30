import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ReplicaSetActionsMenu from "./replicaset-actions-menu.svelte";

describe("ReplicaSetActionsMenu", () => {
  it("renders trigger button", () => {
    const { getByRole } = render(ReplicaSetActionsMenu, {
      props: {
        name: "nginx-rs",
        namespace: "default",
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onScale: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for nginx-rs" })).toBeInTheDocument();
  });

  it("disables trigger when busy", () => {
    const { getByRole } = render(ReplicaSetActionsMenu, {
      props: {
        name: "nginx-rs",
        namespace: "default",
        isBusy: true,
        onShowDetails: vi.fn(),
        onLogs: vi.fn(),
        onScale: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onDownloadYaml: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Open actions for nginx-rs" })).toBeDisabled();
  });
});
