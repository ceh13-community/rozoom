import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PodActionsMenu from "./pod-actions-menu.svelte";

describe("PodActionsMenu", () => {
  it("renders action trigger with pod context", () => {
    const { getByRole } = render(PodActionsMenu, {
      props: {
        name: "api-pod-0",
        namespace: "prod",
        isDeleting: false,
        isEvicting: false,
        isYamlBusy: false,
        isExportingIncident: false,
        isDownloadingYaml: false,
        onShell: vi.fn(),
        onAttach: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onExportIncident: vi.fn(),
        onDownloadYaml: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onPreviousLogs: vi.fn(),
        onPortForward: vi.fn(),
        onEvict: vi.fn(),
        onLogs: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for api-pod-0" })).toBeInTheDocument();
  });

  it("keeps trigger enabled while actions are idle", () => {
    const { getByRole } = render(PodActionsMenu, {
      props: {
        name: "api-pod-0",
        namespace: "prod",
        isDeleting: false,
        isEvicting: false,
        isYamlBusy: false,
        isExportingIncident: false,
        isDownloadingYaml: false,
        onShell: vi.fn(),
        onAttach: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onExportIncident: vi.fn(),
        onDownloadYaml: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onPreviousLogs: vi.fn(),
        onPortForward: vi.fn(),
        onEvict: vi.fn(),
        onLogs: vi.fn(),
        onDelete: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Open actions for api-pod-0" })).not.toHaveAttribute(
      "disabled",
    );
  });

  it("accepts PR2 visibility flags for advanced actions", () => {
    const { component } = render(PodActionsMenu, {
      props: {
        name: "api-pod-0",
        namespace: "prod",
        showEditYaml: false,
        showInvestigate: false,
        showExportIncident: false,
        showDownloadYaml: false,
        showPortForward: false,
        showLogs: false,
        isDeleting: false,
        isEvicting: false,
        isYamlBusy: false,
        isExportingIncident: false,
        isDownloadingYaml: false,
        onShell: vi.fn(),
        onAttach: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onExportIncident: vi.fn(),
        onDownloadYaml: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onPreviousLogs: vi.fn(),
        onPortForward: vi.fn(),
        onEvict: vi.fn(),
        onLogs: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(component).toBeTruthy();
  });
});
