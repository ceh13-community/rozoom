import { telemetryEventBus } from "./telemetry-event-bus";

let started = false;
let stopListening: (() => void) | null = null;

function shouldMirrorEvent(source: string) {
  return source === "watcher";
}

export function initRuntimeLogBridge() {
  if (started) return;
  started = true;
  stopListening = telemetryEventBus.subscribe((event) => {
    if (!shouldMirrorEvent(event.source)) return;

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("runtime:telemetry", { detail: event }));
    }

    if (event.name === "logic_error") {
      console.error("[runtime:watcher]", event.name, event.payload ?? {});
      return;
    }

    console.debug("[runtime:watcher]", event.name, event.payload ?? {});
  });
}

export function stopRuntimeLogBridge() {
  stopListening?.();
  stopListening = null;
  started = false;
}
