export type PortForwardStartMode = "start-only" | "start-and-open";

/** Ports below this need root to listen on, on Linux. */
const FIRST_UNPRIVILEGED_PORT = 1024;
/** Same base as the random local ports of Service port-forwards (30000-60999). */
const PRIVILEGED_PORT_OFFSET = 30000;

const LAST_PORT = 65535;

/**
 * Local port for a port-forward started without asking: the remote port itself, unless that
 * needs root to listen on. A pod serving on 80 gets 30080, on 443 gets 30443; kubectl
 * could not listen on 80 for a normal user and the start failed.
 * A port another forward of the app already holds is skipped: a second pod on 80 gets
 * 30081 instead of failing with "already in use".
 */
export function defaultLocalPort(
  remotePort: number,
  usedPorts: ReadonlySet<number> = new Set(),
): number {
  const preferred =
    remotePort < FIRST_UNPRIVILEGED_PORT ? remotePort + PRIVILEGED_PORT_OFFSET : remotePort;
  for (let port = preferred; port <= LAST_PORT; port += 1) {
    if (!usedPorts.has(port)) return port;
  }
  return preferred;
}

/** Address to show and open for a local forward: kubectl listens on 127.0.0.1. */
export function portForwardLocalUrl(localPort: number, remotePort: number): string {
  const scheme = remotePort === 443 || remotePort === 8443 ? "https" : "http";
  return `${scheme}://127.0.0.1:${localPort}`;
}
