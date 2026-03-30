/**
 * Make a stable, filesystem-safe key from cluster id/name.
 * Keep it deterministic to match how kubeconfigs are stored on disk.
 */
export function clusterKey(input?: string | null): string {
  const s = (input ?? "").trim();
  // Replace anything unsafe for filenames.
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
