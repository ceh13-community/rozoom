import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";

const WATCHER_ERROR_LOG_WINDOW_MS = 15_000;
const WATCHER_CONNECTION_ERROR_LOG_WINDOW_MS = 5 * 60_000;
const recentWatcherErrors = new Map<string, number>();

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const name = error.name.trim();
    const message = error.message.trim();
    const stackLine = error.stack
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.includes(`${name}: ${message}`));
    return [name, message, stackLine].filter(Boolean).join(": ");
  }
  return String(error).trim();
}

function isConnectionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("unable to connect") ||
    lower.includes("no route to host") ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  );
}

export function reportWatcherRuntimeError(
  context: { clusterId: string; kind: string },
  error: unknown,
) {
  const message = normalizeErrorMessage(error);
  if (!message) return;

  const formatted = `[watcher:${context.kind}] ${context.clusterId}: ${message}`;
  const now = Date.now();
  const windowMs = isConnectionError(message)
    ? WATCHER_CONNECTION_ERROR_LOG_WINDOW_MS
    : WATCHER_ERROR_LOG_WINDOW_MS;

  for (const [key, loggedAt] of recentWatcherErrors.entries()) {
    if (now - loggedAt > WATCHER_CONNECTION_ERROR_LOG_WINDOW_MS) {
      recentWatcherErrors.delete(key);
    }
  }

  const loggedAt = recentWatcherErrors.get(formatted);
  if (loggedAt !== undefined && now - loggedAt < windowMs) return;
  recentWatcherErrors.set(formatted, now);
  const isStoppedRetry = message.includes("stopping restarts");
  void (isStoppedRetry ? logWarn(formatted) : logError(formatted));
}
