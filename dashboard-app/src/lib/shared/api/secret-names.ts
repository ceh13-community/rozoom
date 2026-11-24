import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

/**
 * Namespace and name of each secret, one per line, and nothing else. Panels that
 * only draw or index secrets by name must not list them with -o json: that
 * brings every key, password and token in scope into the app.
 */
export const SECRET_NAMES_OUTPUT =
  'jsonpath={range .items[*]}{.metadata.namespace}{"\\t"}{.metadata.name}{"\\n"}{end}';

const OBJECT_NAME = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export type SecretRef = { metadata: { namespace: string; name: string } };

/** Reads SECRET_NAMES_OUTPUT. A line that is not a namespace and a name is skipped. */
export function parseSecretNames(output: string): SecretRef[] {
  const refs: SecretRef[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split("\t");
    if (parts.length !== 2) continue;
    const [namespace, name] = parts;
    if (!OBJECT_NAME.test(namespace) || !OBJECT_NAME.test(name)) continue;
    refs.push({ metadata: { namespace, name } });
  }
  return refs;
}

/**
 * Lists secret names in `scope` (["-A"], ["--all-namespaces"] or ["-n", ns]) in the
 * shape of a kubectl list, so callers keep reading `.items[].metadata`. Returns the
 * kubectl error text on failure.
 */
export async function listSecretNames(
  scope: string[],
  options: { clusterId: string },
): Promise<{ items: SecretRef[] } | string> {
  const result = await kubectlRawArgsFront(
    ["get", "secrets", ...scope, "-o", SECRET_NAMES_OUTPUT],
    options,
  );
  if (result.errors || (result.code !== undefined && result.code !== 0)) {
    return result.errors || `kubectl exited with code ${result.code}`;
  }
  return { items: parseSecretNames(result.output) };
}
