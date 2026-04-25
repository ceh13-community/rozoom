import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchShortcut, type ShortcutHandlers, SHORTCUTS } from "./keyboard-shortcuts";

function makeHandlers(): ShortcutHandlers & {
  calls: Record<string, number>;
  activeFilter: boolean;
} {
  const calls: Record<string, number> = {
    focusSearch: 0,
    clearSearch: 0,
    toggleEnvProd: 0,
    toggleEnvStage: 0,
    toggleEnvDev: 0,
    clearFleetFilter: 0,
    toggleHelp: 0,
  };
  const state = { activeFilter: false };
  return {
    calls,
    get activeFilter() {
      return state.activeFilter;
    },
    set activeFilter(v) {
      state.activeFilter = v;
    },
    focusSearch: () => {
      calls.focusSearch += 1;
    },
    clearSearch: () => {
      calls.clearSearch += 1;
    },
    toggleEnv: (env) => {
      calls[`toggleEnv${env[0].toUpperCase()}${env.slice(1)}`] += 1;
    },
    clearFleetFilter: () => {
      calls.clearFleetFilter += 1;
    },
    toggleHelp: () => {
      calls.toggleHelp += 1;
    },
    hasActiveFilter: () => state.activeFilter,
  };
}

function kev(
  key: string,
  opts: { target?: EventTarget | null; ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key,
    ctrlKey: opts.ctrlKey,
    metaKey: opts.metaKey,
  });
  if (opts.target !== undefined) {
    Object.defineProperty(ev, "target", { value: opts.target });
  }
  return ev;
}

describe("dispatchShortcut", () => {
  let handlers: ReturnType<typeof makeHandlers>;
  beforeEach(() => {
    handlers = makeHandlers();
  });

  it("/ focuses search when not typing", () => {
    expect(dispatchShortcut(kev("/"), handlers)).toBe(true);
    expect(handlers.calls.focusSearch).toBe(1);
  });

  it("p/s/d trigger env filters", () => {
    expect(dispatchShortcut(kev("p"), handlers)).toBe(true);
    expect(dispatchShortcut(kev("S"), handlers)).toBe(true); // case-insensitive
    expect(dispatchShortcut(kev("d"), handlers)).toBe(true);
    expect(handlers.calls.toggleEnvProd).toBe(1);
    expect(handlers.calls.toggleEnvStage).toBe(1);
    expect(handlers.calls.toggleEnvDev).toBe(1);
  });

  it("? opens help", () => {
    expect(dispatchShortcut(kev("?"), handlers)).toBe(true);
    expect(handlers.calls.toggleHelp).toBe(1);
  });

  it("ignores keys while typing in an input", () => {
    const input = document.createElement("input");
    expect(dispatchShortcut(kev("/", { target: input }), handlers)).toBe(false);
    expect(dispatchShortcut(kev("p", { target: input }), handlers)).toBe(false);
    expect(handlers.calls.focusSearch).toBe(0);
  });

  it("ignores keys inside textarea and contenteditable", () => {
    const ta = document.createElement("textarea");
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(dispatchShortcut(kev("/", { target: ta }), handlers)).toBe(false);
    expect(dispatchShortcut(kev("/", { target: div }), handlers)).toBe(false);
  });

  it("Escape in an input with text clears the search", () => {
    const input = document.createElement("input");
    input.value = "prod";
    expect(dispatchShortcut(kev("Escape", { target: input }), handlers)).toBe(true);
    expect(handlers.calls.clearSearch).toBe(1);
  });

  it("Escape outside input clears fleet filter when active", () => {
    handlers.activeFilter = true;
    expect(dispatchShortcut(kev("Escape"), handlers)).toBe(true);
    expect(handlers.calls.clearFleetFilter).toBe(1);
  });

  it("Escape does nothing when no filter and no typing", () => {
    expect(dispatchShortcut(kev("Escape"), handlers)).toBe(false);
    expect(handlers.calls.clearSearch).toBe(0);
    expect(handlers.calls.clearFleetFilter).toBe(0);
  });

  it("ignores keys with modifiers so browser shortcuts still work", () => {
    expect(dispatchShortcut(kev("/", { ctrlKey: true }), handlers)).toBe(false);
    expect(dispatchShortcut(kev("p", { metaKey: true }), handlers)).toBe(false);
  });

  it("returns false for unhandled keys", () => {
    expect(dispatchShortcut(kev("x"), handlers)).toBe(false);
    expect(dispatchShortcut(kev("Enter"), handlers)).toBe(false);
  });

  it("exports the shortcut table for docs/help UI", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(3);
    for (const entry of SHORTCUTS) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});
