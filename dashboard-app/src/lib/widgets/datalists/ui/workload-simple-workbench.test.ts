import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResourceLogsSheet from "./common/resource-logs-sheet.svelte";
import ResourceYamlSheet from "./common/resource-yaml-sheet.svelte";
import WorkloadSimpleWorkbench from "./workload-simple-workbench.svelte";
import { buildDataModeWorkbenchStorageKey } from "./common/workbench-data-mode";

function buildProps(storageKey: string) {
  return {
    storageKey,
    logs: {
      open: true,
      ref: "default/example",
      text: "line-1\nline-2",
      loading: false,
      error: null,
      isLive: false,
      mode: "poll" as const,
      lastUpdatedAt: Date.now(),
      previous: false,
      selectedContainer: "all-containers",
      containerOptions: ["all-containers"],
      bookmarks: [],
      jumpToLine: null,
    },
    yaml: {
      open: true,
      ref: "default/example",
      originalYaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example",
      yamlText: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example",
      loading: false,
      saving: false,
      error: null,
    },
    onCloseLogs: vi.fn(),
    onCloseYaml: vi.fn(),
    onOpenLogs: vi.fn(),
    onOpenYaml: vi.fn(),
    onToggleLogsLive: vi.fn(),
    onSetLogsMode: vi.fn(),
    onToggleLogsPrevious: vi.fn(),
    onSelectLogsContainer: vi.fn(),
    onRefreshLogs: vi.fn(),
    onAddLogsBookmark: vi.fn(),
    onRemoveLogsBookmark: vi.fn(),
    onLogsJumpHandled: vi.fn(),
    onYamlChange: vi.fn(),
    onRefreshYaml: vi.fn(),
    onSaveYaml: vi.fn(),
    logsSheet: ResourceLogsSheet,
    yamlSheet: ResourceYamlSheet,
  };
}

describe("workload-simple-workbench", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders controls and toggles fullscreen/collapse", async () => {
    const props = buildProps("dashboard.test.workbench.1");
    const { getByRole, queryByText } = render(WorkloadSimpleWorkbench, { props });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    expect(getByRole("button", { name: "Close Logs tab" })).toBeTruthy();
    expect(getByRole("button", { name: "Close YAML tab" })).toBeTruthy();
    expect(getByRole("button", { name: "Reopen" })).toBeDisabled();
    expect(getByRole("button", { name: "Fullscreen" })).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "Close Logs tab" }));
    expect(props.onCloseLogs).toHaveBeenCalledTimes(1);
    expect(getByRole("button", { name: "Reopen" })).not.toBeDisabled();

    await fireEvent.click(getByRole("button", { name: "Reopen" }));
    expect(props.onOpenLogs).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByRole("button", { name: "Fullscreen" }));
    expect(getByRole("button", { name: "Exit Fullscreen" })).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "Collapse" }));
    expect(getByRole("button", { name: "Expand" })).toBeTruthy();
    expect(queryByText("Pane 1")).toBeNull();
  }, 15000);

  it("persists selected layout in localStorage", async () => {
    const storageKey = "dashboard.test.workbench.2";
    const props = buildProps(storageKey);
    const first = render(WorkloadSimpleWorkbench, { props });
    const selects = first.container.querySelectorAll("select");
    expect(selects.length).toBeGreaterThan(0);

    await fireEvent.change(selects[0], { target: { value: "triple" } });
    first.unmount();

    const raw = window.localStorage.getItem(
      buildDataModeWorkbenchStorageKey(storageKey, "balanced"),
    );
    expect(raw).toBeTruthy();
    expect(raw).toContain('"layout":"triple"');

    const second = render(WorkloadSimpleWorkbench, { props: buildProps(storageKey) });
    const secondSelects = second.container.querySelectorAll("select");
    expect((secondSelects[0] as HTMLSelectElement).value).toBe("triple");
  });

  it("persists active tab when switching from header tab strip", async () => {
    const storageKey = "dashboard.test.workbench.3";
    const props = buildProps(storageKey);
    const view = render(WorkloadSimpleWorkbench, { props });

    const tabButtons = Array.from(view.container.querySelectorAll("button"));
    const yamlTabButton = tabButtons.find(
      (button) =>
        button.textContent?.includes("YAML") &&
        button.getAttribute("aria-label") !== "Close YAML tab",
    );
    expect(yamlTabButton).toBeTruthy();
    if (!yamlTabButton) return;

    await fireEvent.click(yamlTabButton);
    const raw = window.localStorage.getItem(
      buildDataModeWorkbenchStorageKey(storageKey, "balanced"),
    );
    expect(raw).toContain('"activeTabId":"yaml"');
  });

  it("forces expanded workbench visibility in realtime mode", () => {
    const storageKey = "dashboard.test.workbench.realtime";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        layout: "dual",
        paneTabIds: ["logs", "yaml", null],
        collapsed: true,
        collapsedPaneIndexes: [1],
        activeTabId: "logs",
      }),
    );

    const view = render(WorkloadSimpleWorkbench, {
      props: { ...buildProps(storageKey), dataProfileId: "realtime" },
    });

    expect(view.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
    expect(view.queryByText("Pane 1")).not.toBeNull();
  });

  it("restores pinned tab flag when reopening from closed stack", async () => {
    const props = buildProps("dashboard.test.workbench.4");
    const view = render(WorkloadSimpleWorkbench, { props });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await fireEvent.click(view.getByRole("button", { name: "Pin Logs tab" }));
    await fireEvent.click(view.getByRole("button", { name: "Close Logs tab" }));
    await fireEvent.click(view.getByRole("button", { name: "Reopen" }));

    expect(props.onOpenLogs).toHaveBeenCalledTimes(1);
    expect(view.getByRole("button", { name: "Unpin Logs tab" })).toBeTruthy();
  });

  it("does not close a tab when close confirmation is cancelled", async () => {
    const props = buildProps("dashboard.test.workbench.5");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(WorkloadSimpleWorkbench, { props });

    await fireEvent.click(view.getByRole("button", { name: "Close YAML tab" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(props.onCloseYaml).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Close YAML tab" })).toBeInTheDocument();
  });

  it("asks confirmation before shrinking pane layout when hidden panes contain tabs", async () => {
    const storageKey = "dashboard.test.workbench.6";
    window.localStorage.setItem(
      buildDataModeWorkbenchStorageKey(storageKey, "balanced"),
      JSON.stringify({
        layout: "dual",
        paneTabIds: ["logs", "yaml", null],
        fullscreen: false,
        collapsed: false,
        collapsedPaneIndexes: [],
        activeTabId: "logs",
        pinnedTabIds: [],
        closedTabs: [],
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(WorkloadSimpleWorkbench, { props: buildProps(storageKey) });

    const layoutSelect = view.container.querySelector("select");
    expect(layoutSelect).toBeTruthy();
    if (!layoutSelect) return;

    await fireEvent.change(layoutSelect, { target: { value: "single" } });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(view.getByText("Pane 2")).toBeInTheDocument();
    });
  });

  it("keeps balanced collapse state separate from realtime state", async () => {
    const storageKey = "dashboard.test.workbench.profile-switch";
    const view = render(WorkloadSimpleWorkbench, { props: buildProps(storageKey) });

    await fireEvent.click(view.getByRole("button", { name: "Collapse" }));
    expect(view.getByRole("button", { name: "Expand" })).toBeInTheDocument();

    await view.rerender({ ...buildProps(storageKey), dataProfileId: "realtime" });
    expect(view.getByRole("button", { name: "Collapse" })).toBeInTheDocument();

    await view.rerender({ ...buildProps(storageKey), dataProfileId: "balanced" });
    expect(view.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });
});
