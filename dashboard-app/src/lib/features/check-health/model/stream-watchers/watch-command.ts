const DEFAULT_WATCH_REQUEST_TIMEOUT = "--request-timeout=300s";

function splitCommand(command: string) {
  return command.trim().split(/\s+/).filter(Boolean);
}

export function buildKubectlWatchCommand(command: string) {
  const parts = splitCommand(command);
  if (!parts.some((part) => part === "--watch" || part === "--watch-only" || part === "-w")) {
    parts.push("--watch-only");
  }
  if (!parts.includes("--output-watch-events")) {
    parts.push("--output-watch-events");
  }
  if (!parts.some((part) => part.startsWith("--request-timeout"))) {
    parts.push(DEFAULT_WATCH_REQUEST_TIMEOUT);
  }
  return parts.join(" ");
}

export { DEFAULT_WATCH_REQUEST_TIMEOUT };
