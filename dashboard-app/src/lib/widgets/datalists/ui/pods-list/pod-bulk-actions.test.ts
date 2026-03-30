import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PodBulkActions from "./pod-bulk-actions.svelte";

describe("PodBulkActions", () => {
  it("hides single-item actions when they are not applicable", () => {
    const { queryByRole, getByRole } = render(PodBulkActions, {
      props: {
        canOpenShell: false,
        canAttach: false,
        canEditYaml: false,
        canInvestigate: false,
        canCopyDescribe: false,
        canRunDebugDescribe: false,
        canCopyDebug: false,
        canExportIncident: false,
        canDownloadYaml: false,
        canOpenLogs: false,
        canOpenPreviousLogs: false,
        isYamlBusy: false,
        isExportingIncident: false,
        isDownloadingYaml: false,
        isDeleting: false,
        isEvicting: false,
        onShell: vi.fn(),
        onAttach: vi.fn(),
        onEditYaml: vi.fn(),
        onInvestigate: vi.fn(),
        onCopyDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onCopyDebug: vi.fn(),
        onExportIncident: vi.fn(),
        onDownloadYaml: vi.fn(),
        onEvict: vi.fn(),
        onLogs: vi.fn(),
        onPreviousLogs: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(queryByRole("button", { name: "Shell" })).toBeNull();
    expect(queryByRole("button", { name: "Logs" })).toBeNull();
    expect(queryByRole("button", { name: "Previous logs" })).toBeNull();
    expect(queryByRole("button", { name: "Copy kubectl describe" })).toBeNull();
    expect(queryByRole("button", { name: "Run debug describe" })).toBeNull();
    expect(queryByRole("button", { name: "Copy kubectl debug" })).toBeNull();
    expect(getByRole("button", { name: "Evict selected pods" })).toBeTruthy();
    expect(getByRole("button", { name: "Delete selected pods" })).toBeTruthy();
  });
});
