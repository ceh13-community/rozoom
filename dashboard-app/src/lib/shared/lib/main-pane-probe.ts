import { info, warn } from "@tauri-apps/plugin-log";
import { isTauriAvailable } from "./tauri-runtime";
import {
  describeMainPane,
  formatMainPaneLine,
  looksBlank,
  type MainPaneState,
  type ProbeTrigger,
} from "./main-pane-state";

/**
 * One logs.log line describing what the main pane shows, written a few seconds after
 * each navigation and when the window comes back after a while away.
 *
 * A main pane that shows only the background colour (sidebar fine) was reported after a
 * reconnect and never reproduced on a test stand. Uncaught JS errors already reach
 * logs.log (js-error-log.ts); this line answers the rest without devtools. At the moment
 * the user saw the blank pane, was the DOM empty, was it there but not shown (display,
 * opacity, clipping, something covering it), or was it shown as far as the page can
 * tell, which leaves WebKit losing the paint. The measurement is in main-pane-state.ts.
 */

export const NAVIGATE_DELAY_MS = 3_000;
export const RESTORE_DELAY_MS = 1_000;
/** Shorter absences are ordinary window switching and not worth a line. */
export const MIN_AWAY_MS = 30_000;

interface ProbeOptions {
  getMain: () => HTMLElement | null | undefined;
  getRoute: () => string;
  write: (line: string, blank: boolean) => unknown;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  describe?: (main: HTMLElement) => MainPaneState;
}

export interface MainPaneProbe {
  navigated(): void;
  hidden(): void;
  shown(trigger: Exclude<ProbeTrigger, "navigate">): void;
  dispose(): void;
}

export function createMainPaneProbe({
  getMain,
  getRoute,
  write,
  now = Date.now,
  schedule = (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
  describe = (main) => describeMainPane(main),
}: ProbeOptions): MainPaneProbe {
  let cancelPending: (() => void) | null = null;
  let awaySince: number | null = null;

  function probeLater(trigger: ProbeTrigger, delayMs: number) {
    cancelPending?.();
    cancelPending = schedule(() => {
      cancelPending = null;
      const main = getMain();
      if (!main) return;
      try {
        const state = describe(main);
        void Promise.resolve(
          write(formatMainPaneLine(state, getRoute(), trigger), looksBlank(state)),
        ).catch(() => undefined);
      } catch {
        // A diagnostic must never break the page it describes.
      }
    }, delayMs);
  }

  return {
    navigated() {
      probeLater("navigate", NAVIGATE_DELAY_MS);
    },
    hidden() {
      awaySince ??= now();
    },
    shown(trigger) {
      const since = awaySince;
      awaySince = null;
      if (since === null || now() - since < MIN_AWAY_MS) return;
      probeLater(trigger, RESTORE_DELAY_MS);
    },
    dispose() {
      cancelPending?.();
      cancelPending = null;
    },
  };
}

/**
 * Wires the probe to the window. Returns the probe (call `navigated()` from the layout's
 * afterNavigate) and a cleanup. Outside Tauri there is no logs.log, so nothing is wired.
 */
export function installMainPaneProbe(
  getMain: ProbeOptions["getMain"],
  getRoute: ProbeOptions["getRoute"],
  target: Window = window,
): { probe: MainPaneProbe; dispose: () => void } {
  const probe = createMainPaneProbe({
    getMain,
    getRoute,
    write: (line, blank) => (blank ? warn(line) : info(line)),
  });
  if (!isTauriAvailable()) {
    return {
      probe: { ...probe, navigated() {} },
      dispose: () => {
        probe.dispose();
      },
    };
  }

  const doc = target.document;
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") probe.hidden();
    else probe.shown("visible");
  };
  // On Wayland, GTK3 minimize does not set document.hidden, so blur/focus is the only
  // signal that the window was away.
  const onBlur = () => {
    probe.hidden();
  };
  const onFocus = () => {
    probe.shown("focus");
  };

  doc.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("blur", onBlur);
  target.addEventListener("focus", onFocus);
  return {
    probe,
    dispose: () => {
      doc.removeEventListener("visibilitychange", onVisibility);
      target.removeEventListener("blur", onBlur);
      target.removeEventListener("focus", onFocus);
      probe.dispose();
    },
  };
}
