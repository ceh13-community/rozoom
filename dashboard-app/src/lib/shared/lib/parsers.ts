/**
 * The cluster itself did not answer (network, certificate, credentials), so the
 * probe says nothing about the component it asked for: shown as "Unknown", never
 * as "Installed but unreachable".
 */
export const CLUSTER_DID_NOT_ANSWER = 3;

// kubectl's own failures before any API answer. "Error from server ..." means the
// API server answered, for example that it could not reach the component's
// service: that is a real result about the component, not about the cluster.
const NO_ANSWER_FROM_CLUSTER =
  /unable to connect to the server|dial tcp|no route to host|connection refused|was refused|no such host|i\/o timeout|tls handshake|x509|certificate|must be logged in|provide credentials|getting credentials|exec plugin|\bunauthorized\b/i;

export const checkResponseStatus = (stderr: string) => {
  const text = stderr.toLowerCase();

  if (!text.includes("error from server") && NO_ANSWER_FROM_CLUSTER.test(text)) {
    return CLUSTER_DID_NOT_ANSWER;
  }

  if (text.includes("unauthorized") || text.includes("forbidden")) {
    return 0;
  } else if (text.includes("notfound") || text.includes("404")) {
    return -1;
  } else if (text.includes("timeout")) {
    return 2;
  } else if (text.includes("tls") || text.includes("x509") || text.includes("certificate")) {
    return 0;
  }

  return 0;
};
