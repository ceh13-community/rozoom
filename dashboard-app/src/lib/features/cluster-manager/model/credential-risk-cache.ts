/**
 * Per-cluster credential risk cache.
 *
 * Reads each cluster's kubeconfig from disk once per session, parses it,
 * runs `analyzeCredentialSecurity`, and caches the report in-memory so
 * dashboard cards can surface a lightweight risk chip without re-parsing
 * YAML on every render.
 */
import { parseKubeconfigText } from "$entities/config/";
import { getClusterFromDisk } from "../api/disk";
import { analyzeCredentialSecurity, type CredentialSecurityReport } from "./credential-security";

const cache = new Map<string, CredentialSecurityReport | null>();
const inflight = new Map<string, Promise<CredentialSecurityReport | null>>();

export function getCachedCredentialReport(
  uuid: string,
): CredentialSecurityReport | null | undefined {
  return cache.get(uuid);
}

export async function loadCredentialReport(
  uuid: string,
  clusterName: string,
): Promise<CredentialSecurityReport | null> {
  if (cache.has(uuid)) return cache.get(uuid) ?? null;
  const existing = inflight.get(uuid);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const raw = await getClusterFromDisk(uuid);
      if (!raw) return null;
      const config = await parseKubeconfigText(raw);
      if (config.users.length === 0 || config.clusters.length === 0) return null;
      const user = config.users[0];
      const cluster = config.clusters[0];
      const report = analyzeCredentialSecurity({
        clusterName,
        hasEmbeddedToken: !!user.hasToken,
        hasEmbeddedCert: !!user.hasCertAuth,
        hasEmbeddedKey: !!user.hasCertAuth,
        usesExecPlugin: !!user.execCommand,
        usesAuthProvider: !!user.authProvider,
        insecureSkipTlsVerify: !!cluster.insecureSkipTlsVerify,
        storedPlaintext: true,
      });
      cache.set(uuid, report);
      return report;
    } catch {
      cache.set(uuid, null);
      return null;
    } finally {
      inflight.delete(uuid);
    }
  })();

  inflight.set(uuid, promise);
  return promise;
}

export function invalidateCredentialReport(uuid: string): void {
  cache.delete(uuid);
  inflight.delete(uuid);
}

export function clearCredentialReportCache(): void {
  cache.clear();
  inflight.clear();
}
