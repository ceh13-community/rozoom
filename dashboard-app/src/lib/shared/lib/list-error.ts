// What a list says when kubectl refuses to list its resources.

/** The kubectl message without the app's "[ERROR] [time]:" prefix and "Error from server". */
function kubectlMessage(text: string) {
  return text
    .replace(/^\[ERROR\] \[[^\]]*\]:\s*/, "")
    .replace(/^Error from server \([^)]*\):\s*/, "")
    .split("\n")[0]
    .trim();
}

/**
 * A readable error for a list that could not load. Forbidden says it is about access
 * (RBAC), so "no access" does not look like "no items".
 */
export function describeListError(errorText: string, listTitle: string) {
  const message = kubectlMessage(errorText);
  if (/forbidden/i.test(errorText)) {
    return `No access to ${listTitle}: your Kubernetes user is not allowed to list them (RBAC). ${message}`;
  }
  return `Could not load ${listTitle}: ${message || "kubectl failed"}`;
}
