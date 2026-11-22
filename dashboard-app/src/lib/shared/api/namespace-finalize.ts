// Force finalize a namespace stuck in Terminating.
//
// The namespace finalizers change only through the finalize subresource, and only with a
// PUT: `kubectl patch namespace X -p '{"spec":{"finalizers":[]}}'` answers "patched (no
// change)" and `--subresource=finalize` is refused (MethodNotAllowed). So the namespace is
// read, its spec.finalizers emptied, and the object sent back with
// `kubectl replace --raw /api/v1/namespaces/<name>/finalize -f <file>`.

type KubectlRawResult = { output: string; errors: string; code?: number };

export type FinalizeDeps = {
  kubectl: (args: string[]) => Promise<KubectlRawResult>;
  /** Writes an owner-only temp file and returns its path. */
  writeTempFile: (content: string) => Promise<string>;
  removeFile: (path: string) => Promise<void>;
};

export type FinalizeResult = { ok: true } | { ok: false; error: string };

function kubectlError(result: KubectlRawResult, fallback: string) {
  return (result.errors || result.output || fallback).trim();
}

export async function forceFinalizeNamespace(
  name: string,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  const read = await deps.kubectl(["get", "namespace", name, "-o", "json"]);
  if (read.errors || read.code !== 0) {
    return { ok: false, error: kubectlError(read, `Could not read namespace ${name}`) };
  }
  let namespace: {
    metadata?: { deletionTimestamp?: string };
    spec?: { finalizers?: string[] };
    status?: { phase?: string };
  };
  try {
    namespace = JSON.parse(read.output) as typeof namespace;
  } catch {
    return { ok: false, error: `Could not read namespace ${name}` };
  }
  // On a namespace that is not being deleted, removing the finalizer makes a later delete
  // skip the content cleanup and leave its objects behind.
  if (namespace.status?.phase !== "Terminating" || !namespace.metadata?.deletionTimestamp) {
    return {
      ok: false,
      error: `Namespace "${name}" is not stuck in Terminating. Delete it first; force finalize only a namespace whose deletion does not finish.`,
    };
  }
  namespace.spec = { ...namespace.spec, finalizers: [] };

  const path = await deps.writeTempFile(JSON.stringify(namespace));
  try {
    const result = await deps.kubectl([
      "replace",
      "--raw",
      `/api/v1/namespaces/${encodeURIComponent(name)}/finalize`,
      "-f",
      path,
    ]);
    if (result.errors || result.code !== 0) {
      return { ok: false, error: kubectlError(result, `Failed to finalize namespace ${name}`) };
    }
    return { ok: true };
  } finally {
    await deps.removeFile(path).catch(() => undefined);
  }
}

/** What the person agrees to; shown before the namespace is force-finalized. */
export function forceFinalizeConfirmText(name: string) {
  return [
    `Force finalize namespace "${name}"?`,
    "",
    "Kubernetes deletes the namespace without waiting for the cleanup its finalizers guard. Use this only for a namespace stuck in Terminating.",
    "",
    "Objects still in the namespace are not deleted: they stay in the cluster store, hidden, and come back if a namespace with the same name is created. Their own cleanup does not run, so cloud load balancers, volumes and DNS records they created stay behind and can keep costing money. This cannot be undone.",
  ].join("\n");
}
