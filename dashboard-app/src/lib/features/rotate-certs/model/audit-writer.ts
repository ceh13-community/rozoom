/**
 * Serialised writes to the certificate-rotation audit ConfigMap.
 *
 * Renew All (strategy 2) records two entries almost at once: approve-all from the approve
 * loop and rotate from the finally block. Fired concurrently, both built their payload from
 * the same in-memory log, so the second PATCH overwrote the first; on a cluster without the
 * ConfigMap yet the second create failed with AlreadyExists and raised a false "Audit trail
 * not persisted" toast (reviewer, 09/11/2026: verify-1.txt kept approve-all only). Every
 * append now waits for the previous write to settle and reads the log again after it, so
 * each payload builds on what the cluster actually holds.
 */
export type AuditEntry = { ts: string; action: string; detail: string };

/** The part of a kubectl result the writer needs; the proxy result satisfies it. */
export type AuditCliResult = { code?: number; errors?: string };

export type AuditWriteOutcome =
  | { ok: true }
  /** `create`: the ConfigMap was missing and could not be created. `error`: a call threw. */
  | { ok: false; stage: "create" | "error"; message: string };

export type AuditWriterDeps = {
  /** Entries currently known, newest first (the order the panel shows). */
  readLog: () => AuditEntry[];
  /** PATCH the ConfigMap with the full payload, oldest first. Non-zero code: missing. */
  patch: (payload: string) => Promise<AuditCliResult>;
  /** CREATE the ConfigMap with the same payload when PATCH reported it missing. */
  create: (payload: string) => Promise<AuditCliResult>;
  /** Runs after a successful write, before the next queued entry reads the log. */
  onWritten: () => Promise<void>;
  /** Oldest entries beyond this count are dropped from the payload. */
  maxEntries?: number;
};

export const AUDIT_MAX_ENTRIES = 50;

export function createAuditWriter(deps: AuditWriterDeps) {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    /** Queue one entry; resolves once its write and the read-back have settled. */
    append(entry: AuditEntry): Promise<AuditWriteOutcome> {
      const run = tail.then(() => writeOne(deps, entry));
      // writeOne never rejects; the catch only guarantees a later entry can never stall.
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

async function writeOne(deps: AuditWriterDeps, entry: AuditEntry): Promise<AuditWriteOutcome> {
  const outcome = await persist(deps, entry);
  if (outcome.ok) await deps.onWritten().catch(() => undefined);
  return outcome;
}

async function persist(deps: AuditWriterDeps, entry: AuditEntry): Promise<AuditWriteOutcome> {
  try {
    const max = deps.maxEntries ?? AUDIT_MAX_ENTRIES;
    // Stored oldest first; the panel keeps the newest on top, so reverse before appending.
    const next = [...deps.readLog().slice().reverse(), entry].slice(-max);
    const payload = JSON.stringify(next);
    const patched = await deps.patch(payload);
    if (patched.code === 0) return { ok: true };
    const created = await deps.create(payload);
    if (created.code === 0) return { ok: true };
    return { ok: false, stage: "create", message: created.errors || patched.errors || "" };
  } catch (err) {
    return { ok: false, stage: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
