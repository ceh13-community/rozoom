/**
 * Infer environment label (prod / stage / dev / shared) from a cluster
 * name. Kept conservative: only matches common substrings. Always
 * returns a non-empty string so callers can rely on it as a bucket key.
 */
export function inferEnv(name: string): string {
  const hint = name.toLowerCase();
  if (hint.includes("prod")) return "prod";
  if (hint.includes("stage") || hint.includes("staging")) return "stage";
  if (hint.includes("dev")) return "dev";
  return "shared";
}
