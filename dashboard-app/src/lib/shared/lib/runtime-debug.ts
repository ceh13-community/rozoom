import { safeDebugLog } from "./tauri-runtime";

export type RuntimeDebugScope =
  | "runtime"
  | "overview"
  | "watchers"
  | "kubectl"
  | "background-pollers"
  | "network-recovery"
  | "fleet-heartbeat";

const IS_PRODUCTION = import.meta.env.PROD;
const ENABLE_RUNTIME_FILE_LOGS = import.meta.env.VITE_ENABLE_RUNTIME_FILE_LOGS === "true";
const ENABLE_VERBOSE_RUNTIME_LOGS = import.meta.env.VITE_ENABLE_VERBOSE_RUNTIME_LOGS === "true";

const SCOPE_ENV_FLAGS: Record<Exclude<RuntimeDebugScope, "runtime">, boolean> = {
  overview: import.meta.env.VITE_ENABLE_OVERVIEW_TRACE === "true",
  watchers: import.meta.env.VITE_ENABLE_WATCHERS_TRACE === "true",
  kubectl: import.meta.env.VITE_ENABLE_KUBECTL_TRACE === "true",
  "background-pollers": import.meta.env.VITE_ENABLE_BACKGROUND_POLLERS_TRACE === "true",
  "network-recovery": import.meta.env.VITE_ENABLE_BACKGROUND_POLLERS_TRACE === "true",
  "fleet-heartbeat": import.meta.env.VITE_ENABLE_BACKGROUND_POLLERS_TRACE === "true",
};

export function isRuntimeDebugEnabled(scope: RuntimeDebugScope = "runtime") {
  if (IS_PRODUCTION && !ENABLE_RUNTIME_FILE_LOGS) return false;
  if (!ENABLE_RUNTIME_FILE_LOGS) return false;
  if (ENABLE_VERBOSE_RUNTIME_LOGS) return true;
  if (scope === "runtime") return false;
  return SCOPE_ENV_FLAGS[scope];
}

export async function writeRuntimeDebugLog(
  scope: RuntimeDebugScope,
  event: string,
  details: Record<string, unknown> = {},
) {
  if (!isRuntimeDebugEnabled(scope)) return;
  await safeDebugLog(
    `[runtime:${scope}] ${JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...details,
    })}`,
  );
}
