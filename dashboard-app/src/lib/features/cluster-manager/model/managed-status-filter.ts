/**
 * Status filter on the managed cluster list. A row counts as online only when
 * the user has not switched it offline and the live probe has no problem with
 * it, so the filter agrees with the row pill and with Fleet Health.
 */
export function matchesManagedStatusFilter(
  filter: string,
  row: { offline?: boolean; liveProblem: string | null },
): boolean {
  const notOnline = Boolean(row.offline) || row.liveProblem !== null;
  if (filter === "online") return !notOnline;
  if (filter === "offline") return notOnline;
  return true;
}
