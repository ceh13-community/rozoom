export type PortForwardStartMode = "start-only" | "start-and-open";

/** Ports below this need root to listen on, on Linux. */
const FIRST_UNPRIVILEGED_PORT = 1024;
/** Same base as the random local ports of Service port-forwards (30000-60999). */
const PRIVILEGED_PORT_OFFSET = 30000;

/**
 * Local port for a port-forward started without asking: the remote port itself, unless that
 * needs root to listen on. A pod serving on 80 gets 30080, on 443 gets 30443; kubectl
 * could not listen on 80 for a normal user and the start failed.
 */
export function defaultLocalPort(remotePort: number): number {
  return remotePort < FIRST_UNPRIVILEGED_PORT ? remotePort + PRIVILEGED_PORT_OFFSET : remotePort;
}

export function requestPortForwardStartMode(remotePort: number): PortForwardStartMode | null {
  if (typeof window === "undefined") return "start-only";
  if (typeof window.prompt !== "function") return "start-only";
  let answer: string | null = null;
  try {
    answer = window.prompt(
      `Remote port: ${remotePort}\nChoose start mode:\n1 - Create Port Forward only\n2 - Create Port Forward + Open Web`,
      "2",
    );
  } catch {
    return "start-only";
  }
  if (answer === null) return null;
  const normalized = answer.trim();
  if (normalized === "1") return "start-only";
  if (normalized === "2") return "start-and-open";
  return null;
}
