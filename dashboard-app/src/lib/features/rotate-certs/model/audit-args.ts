/**
 * kubectl argument arrays for the certificate-rotation audit ConfigMap.
 *
 * The audit payload embeds CSR names, and the API server does not validate CSR names:
 * `z rev-wipe --patch='data': y` is a legal one. Built as a template string and split on
 * whitespace, such a name became extra kubectl flags; on a stand (reviewer, 09/11/2026)
 * it wiped the data of a ConfigMap in kube-system with the operator's rights. Every value
 * here is one argv element, so nothing inside the payload can be parsed as a flag.
 */
export type AuditTarget = {
  name: string;
  namespace: string;
  key: string;
};

/** `kubectl patch configmap … --type=merge -p <json>`; the JSON is one argument. */
export function buildAuditPatchArgs(target: AuditTarget, payload: string): string[] {
  const patch = JSON.stringify({ data: { [target.key]: payload } });
  return [
    "patch",
    "configmap",
    target.name,
    "-n",
    target.namespace,
    "--type=merge",
    "-p",
    patch,
    "--request-timeout=10s",
  ];
}

/** `kubectl create configmap … --from-literal=<key>=<payload>`; one argument, payload verbatim. */
export function buildAuditCreateArgs(target: AuditTarget, payload: string): string[] {
  return [
    "create",
    "configmap",
    target.name,
    "-n",
    target.namespace,
    `--from-literal=${target.key}=${payload}`,
    "--request-timeout=10s",
  ];
}
