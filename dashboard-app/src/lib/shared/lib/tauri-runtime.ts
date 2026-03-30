type TauriInternals = {
  invoke?: (cmd: string, payload?: unknown) => Promise<unknown>;
  transformCallback?: unknown;
  metadata?: {
    currentWindow?: unknown;
  };
};

function getTauriInternals(): TauriInternals | null {
  if (typeof window === "undefined") return null;
  const internals = (window as typeof window & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  return internals ?? null;
}

export function isTauriAvailable() {
  if (typeof window === "undefined") return false;
  if ("__TAURI__" in window) return true;
  const internals = getTauriInternals();
  return Boolean(
    internals &&
      typeof internals.invoke === "function" &&
      typeof internals.transformCallback === "function" &&
      internals.metadata?.currentWindow,
  );
}

export function getBrowserInvokeFallback() {
  const internals = getTauriInternals();
  if (!internals || typeof internals.invoke !== "function") return null;
  const hasDesktopWindowBridge =
    typeof internals.transformCallback === "function" && Boolean(internals.metadata?.currentWindow);
  if (hasDesktopWindowBridge) return null;
  if (!isTauriAvailable()) return internals.invoke;
  return typeof internals.invoke === "function" ? internals.invoke : null;
}

export async function safeDialogOpen(options: {
  filters?: Array<{ name: string; extensions: string[] }>;
}) {
  if (!isTauriAvailable()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open(options);
}

export async function safeDialogAsk(
  message: string,
  options: { title: string; kind?: "info" | "warning" | "error" } = { title: "Confirm" },
) {
  if (!isTauriAvailable()) {
    return typeof window !== "undefined" ? window.confirm(message) : false;
  }
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, options);
}

export async function safeReadTextFile(path: string) {
  if (!isTauriAvailable()) {
    throw new Error("File system access is available only in the desktop runtime");
  }
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

export async function safeDebugLog(message: string) {
  if (!isTauriAvailable()) return;
  const { debug } = await import("@tauri-apps/plugin-log");
  await debug(message);
}
