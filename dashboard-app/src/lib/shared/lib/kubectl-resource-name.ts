/**
 * Guard for resource names that the app hands to kubectl as a positional argument.
 *
 * Kubernetes validates most names (DNS labels and subdomains), but not all: a
 * CertificateSigningRequest may be called `pending-a --as=nobody`, and a Role may be
 * called `--all`. Split into argv by whitespace, such a name turns into extra flags;
 * even as one argument, a leading dash is read as a flag unless `--` precedes it.
 * Call-sites therefore (1) build an argument array, (2) put `--` before the name and
 * (3) refuse names this guard rejects, so nothing from the cluster is ever parsed as
 * a flag or as a second name.
 */
export function unsafeKubectlNameReason(name: string): string | null {
  if (!name) return "empty name";
  if (name.startsWith("-")) return "name starts with a dash";
  if (/\s/.test(name)) return "name contains whitespace";
  // eslint-disable-next-line no-control-regex -- control characters are the point here
  if (/[\x00-\x1f\x7f]/.test(name)) return "name contains control characters";
  return null;
}

export function isSafeKubectlName(name: string): boolean {
  return unsafeKubectlNameReason(name) === null;
}

/** Throws with a plain-language reason; use at the boundary that builds kubectl argv. */
export function assertSafeKubectlName(name: string, kind = "resource"): string {
  const reason = unsafeKubectlNameReason(name);
  if (reason) {
    throw new Error(`Refusing to pass ${kind} name ${JSON.stringify(name)} to kubectl: ${reason}.`);
  }
  return name;
}
