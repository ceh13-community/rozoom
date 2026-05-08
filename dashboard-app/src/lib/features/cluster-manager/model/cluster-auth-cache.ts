/**
 * Per-cluster auth method cache. Reads the kubeconfig from disk once
 * per session, detects which authentication mechanism the cluster uses,
 * and memoises the result so the Managed Clusters card can show a small
 * chip (OIDC / token / cert / exec) without re-parsing YAML on render.
 *
 * Sibling to credential-risk-cache: same data source, different
 * projection. Kept separate so the two can be used independently.
 */
import { parseKubeconfigText } from "$entities/config/";
import { getClusterFromDisk } from "../api/disk";
import { detectAuthMethod, type AuthMethodInfo } from "./auth-detection";

const cache = new Map<string, AuthMethodInfo | null>();
const inflight = new Map<string, Promise<AuthMethodInfo | null>>();

export function getCachedAuthInfo(uuid: string): AuthMethodInfo | null | undefined {
  return cache.get(uuid);
}

export async function loadClusterAuthInfo(uuid: string): Promise<AuthMethodInfo | null> {
  if (cache.has(uuid)) return cache.get(uuid) ?? null;
  const existing = inflight.get(uuid);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const raw = await getClusterFromDisk(uuid);
      if (!raw) return null;
      const config = await parseKubeconfigText(raw);
      const user = config.users[0] as (typeof config.users)[0] | undefined;
      if (!user) return null;
      const info = detectAuthMethod({
        execCommand: user.execCommand,
        authProvider: user.authProvider,
        hasToken: user.hasToken,
        hasCertAuth: user.hasCertAuth,
      });
      cache.set(uuid, info);
      return info;
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

export function invalidateClusterAuthInfo(uuid: string): void {
  cache.delete(uuid);
  inflight.delete(uuid);
}

export function clearClusterAuthCache(): void {
  cache.clear();
  inflight.clear();
}
