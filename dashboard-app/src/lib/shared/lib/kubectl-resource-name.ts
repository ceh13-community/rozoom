/**
 * Guard for resource names that the app hands to kubectl as a positional argument.
 *
 * Kubernetes validates most names (DNS labels and subdomains), but not all: a
 * CertificateSigningRequest may be called `pending-a --as=nobody`, and a Role may be
 * called `--all`. Split into argv by whitespace, such a name turns into extra flags;
 * even as one argument, a leading dash is read as a flag unless `--` precedes it.
 *
 * Two layers, decided 09/11/2026 (card cJhsVCMI):
 * - every call-site builds an argument array and puts `--` before the name; that alone
 *   makes `delete role -- --all` delete only the Role literally named `--all`, so delete
 *   paths keep working for such names and do not use this guard;
 * - CSR approve additionally refuses names this guard rejects, because approving issues a
 *   certificate and the API server accepts any string as a CSR name.
 */
export function unsafeKubectlNameReason(name: string): string | null {
  if (!name) return "empty name";
  if (name.startsWith("-")) return "name starts with a dash";
  if (/\s/.test(name)) return "name contains whitespace";
  // eslint-disable-next-line no-control-regex -- control characters are the point here
  if (/[\x00-\x1f\x7f]/.test(name)) return "name contains control characters";
  return null;
}
