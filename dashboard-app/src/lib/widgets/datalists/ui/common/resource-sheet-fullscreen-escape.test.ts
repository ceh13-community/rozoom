import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResourceLogsSheet from "./resource-logs-sheet.svelte";
import ResourceYamlSheet from "./resource-yaml-sheet.svelte";

vi.mock("$shared/ui/yaml-editor.svelte", async () => ({
  default: (await import("../../../../../test/mocks/yaml-editor-stub.svelte")).default,
}));

const logsProps = {
  embedded: true,
  isOpen: writable(true),
  podRef: "shop/web-1",
  logs: "line 1",
  loading: false,
  error: null,
  isLive: true,
  mode: "stream-f",
  lastUpdatedAt: null,
  previous: false,
  selectedContainer: "web",
  containerOptions: ["web"],
  bookmarks: [],
  onToggleLive: vi.fn(),
  onSetMode: vi.fn(),
  onTogglePrevious: vi.fn(),
  onSelectContainer: vi.fn(),
  onRefresh: vi.fn(),
  onAddBookmark: vi.fn(),
  onRemoveBookmark: vi.fn(),
  jumpToLine: null,
  onJumpHandled: vi.fn(),
};

const yamlProps = {
  embedded: true,
  isOpen: writable(true),
  podRef: "shop/web",
  originalYaml: "kind: Deployment\n",
  yamlText: "kind: Deployment\n",
  loading: false,
  saving: false,
  error: null,
  onYamlChange: vi.fn(),
  onRefresh: vi.fn(),
  onSave: vi.fn(),
};

// Deployments and DaemonSets close the active workbench tab on Esc from a window listener
// that is added before the panel mounts, and skip a key that is already used. Esc on a
// panel shown full screen must leave full screen only.
describe("Esc on a logs or YAML panel shown full screen, in the Deployments list", () => {
  const closeTab = vi.fn();
  function deploymentsListKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    closeTab();
  }

  beforeEach(() => {
    closeTab.mockClear();
    window.addEventListener("keydown", deploymentsListKeydown);
  });

  afterEach(() => {
    window.removeEventListener("keydown", deploymentsListKeydown);
  });

  it.each([
    ["logs", ResourceLogsSheet, logsProps],
    ["YAML", ResourceYamlSheet, yamlProps],
  ] as const)(
    "%s: the first Esc leaves full screen, the next closes the tab",
    async (_, Sheet, props) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(Sheet as any, { props });
      await fireEvent.click(screen.getByTitle("Open full screen"));
      expect(document.querySelector("[data-fullscreen-panel]")).not.toBeNull();

      await fireEvent.keyDown(document.querySelector("[data-fullscreen-panel]") as Element, {
        key: "Escape",
      });
      expect(document.querySelector("[data-fullscreen-panel]")).toBeNull();
      expect(closeTab).not.toHaveBeenCalled();

      await fireEvent.keyDown(screen.getByTitle("Open full screen"), { key: "Escape" });
      expect(closeTab).toHaveBeenCalledOnce();
    },
  );

  // The YAML editor closes its search (Ctrl+F), completion or lint panel on Esc and marks
  // the key used. That Esc must stay the editor's; the next one leaves full screen.
  it.each([
    ["logs", ResourceLogsSheet, logsProps],
    ["YAML", ResourceYamlSheet, yamlProps],
  ] as const)(
    "%s: Esc the editor uses stays full screen, the next Esc leaves it",
    async (_, Sheet, props) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(Sheet as any, { props });
      await fireEvent.click(screen.getByTitle("Open full screen"));
      const panel = document.querySelector("[data-fullscreen-panel]") as Element;
      const editor = document.createElement("div");
      editor.className = "cm-editor";
      editor.innerHTML =
        '<input aria-label="Find" /><div class="cm-content" contenteditable="true">kind: Deployment</div>';
      panel.appendChild(editor);
      // Like the editor's search field: Esc closes the search and is marked used.
      const find = editor.querySelector("input") as HTMLInputElement;
      find.addEventListener("keydown", (event) => {
        if (event.key === "Escape") event.preventDefault();
      });

      await fireEvent.keyDown(find, { key: "Escape" });
      expect(document.querySelector("[data-fullscreen-panel]")).not.toBeNull();
      expect(closeTab).not.toHaveBeenCalled();

      // Back in the text, nothing in the editor takes Esc: full screen ends, the tab stays.
      await fireEvent.keyDown(editor.querySelector(".cm-content") as Element, { key: "Escape" });
      expect(document.querySelector("[data-fullscreen-panel]")).toBeNull();
      expect(closeTab).not.toHaveBeenCalled();
    },
  );

  it("Esc in a field of the panel leaves full screen and keeps the tab", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(ResourceLogsSheet as any, { props: logsProps });
    await fireEvent.click(screen.getByTitle("Open full screen"));
    const field = document.createElement("input");
    (document.querySelector("[data-fullscreen-panel]") as Element).appendChild(field);

    await fireEvent.keyDown(field, { key: "Escape" });
    expect(document.querySelector("[data-fullscreen-panel]")).toBeNull();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it.each(["deployments-list.svelte", "daemon-sets-list.svelte"])(
    "%s skips an Esc that is already used",
    (file) => {
      const source = readFileSync(resolve(__dirname, "..", file), "utf8");
      const handler = source.slice(source.indexOf("function handleWindowKeydown"));
      expect(handler.slice(0, 200)).toContain("event.defaultPrevented");
    },
  );
});
