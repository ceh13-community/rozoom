export function resolveClusterIds(input: { slug?: string | null; uuid?: string | null }): string[] {
  const values = [input.uuid, input.slug]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(values)];
}

export function resolvePrimaryClusterId(input: {
  slug?: string | null;
  uuid?: string | null;
}): string {
  return resolveClusterIds(input)[0] ?? "";
}
