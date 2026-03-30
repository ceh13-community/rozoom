/**
 * Cluster management audit trail.
 *
 * Records who/when performed configuration changes on clusters.
 * Persisted to local store for review.
 */

import { storeManager } from "$shared/store";

const STORE_NAME = "dashboard-preferences.json";
const AUDIT_KEY = "clusterAuditTrail";
const MAX_ENTRIES = 500;

export type AuditAction =
  | "cluster-added"
  | "cluster-removed"
  | "cluster-restored"
  | "cluster-purged"
  | "cluster-renamed"
  | "meta-updated"
  | "group-created"
  | "group-deleted"
  | "cluster-moved-to-group"
  | "catalog-exported"
  | "catalog-imported";

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: AuditAction;
  clusterName?: string;
  clusterUuid?: string;
  details?: string;
};

export function createAuditEntry(
  action: AuditAction,
  opts?: { clusterName?: string; clusterUuid?: string; details?: string },
): AuditEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    ...opts,
  };
}

export async function loadAuditTrail(): Promise<AuditEntry[]> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(AUDIT_KEY)) as AuditEntry[] | null;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    const trail = await loadAuditTrail();
    trail.unshift(entry);
    const trimmed = trail.slice(0, MAX_ENTRIES);
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(AUDIT_KEY, trimmed);
    await store.save();
  } catch {
    // best-effort
  }
}

export async function recordAudit(
  action: AuditAction,
  opts?: { clusterName?: string; clusterUuid?: string; details?: string },
): Promise<void> {
  const entry = createAuditEntry(action, opts);
  await appendAuditEntry(entry);
}
