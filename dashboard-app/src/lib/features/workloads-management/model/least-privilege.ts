/**
 * Least Privilege Analyzer (#12)
 *
 * Compares granted RBAC permissions vs actual API usage to find overprivileged subjects.
 */

export type PrivilegeGap = {
  resource: string;
  grantedVerbs: string[];
  usedVerbs: string[];
  unusedVerbs: string[];
  reductionPercent: number;
};
export type LeastPrivilegeEntry = {
  subjectName: string;
  subjectKind: string;
  namespace: string;
  gaps: PrivilegeGap[];
  overallReductionPercent: number;
  recommendation: string;
};
export type LeastPrivilegeReport = {
  entries: LeastPrivilegeEntry[];
  totalSubjects: number;
  overprivilegedCount: number;
  averageReduction: number;
};

export function analyzeLeastPrivilege(
  subjects: Array<{
    name: string;
    kind: string;
    namespace: string;
    permissions: Array<{ resource: string; verbs: string[] }>;
  }>,
  usage: Array<{ subjectName: string; resource: string; verb: string }>,
): LeastPrivilegeReport {
  const usageMap = new Map<string, Set<string>>();
  for (const u of usage) {
    const key = `${u.subjectName}:${u.resource}`;
    const set = usageMap.get(key) ?? new Set();
    set.add(u.verb);
    usageMap.set(key, set);
  }

  const entries: LeastPrivilegeEntry[] = subjects.map((subject) => {
    const gaps: PrivilegeGap[] = [];
    let totalGranted = 0,
      totalUnused = 0;

    for (const perm of subject.permissions) {
      const usedVerbs = [...(usageMap.get(`${subject.name}:${perm.resource}`) ?? [])];
      const unusedVerbs = perm.verbs.filter((v) => v !== "*" && !usedVerbs.includes(v));
      totalGranted += perm.verbs.length;
      totalUnused += unusedVerbs.length;
      if (unusedVerbs.length > 0) {
        gaps.push({
          resource: perm.resource,
          grantedVerbs: perm.verbs,
          usedVerbs,
          unusedVerbs,
          reductionPercent: Math.round((unusedVerbs.length / perm.verbs.length) * 100),
        });
      }
    }

    const overallReduction = totalGranted > 0 ? Math.round((totalUnused / totalGranted) * 100) : 0;
    return {
      subjectName: subject.name,
      subjectKind: subject.kind,
      namespace: subject.namespace,
      gaps,
      overallReductionPercent: overallReduction,
      recommendation:
        overallReduction > 50
          ? "Significantly overprivileged - tighten roles"
          : overallReduction > 20
            ? "Moderately overprivileged - review unused verbs"
            : "Acceptable privilege level",
    };
  });

  entries.sort((a, b) => b.overallReductionPercent - a.overallReductionPercent);
  const overprivileged = entries.filter((e) => e.overallReductionPercent > 20).length;
  const avg =
    entries.length > 0
      ? Math.round(entries.reduce((s, e) => s + e.overallReductionPercent, 0) / entries.length)
      : 0;

  return {
    entries,
    totalSubjects: entries.length,
    overprivilegedCount: overprivileged,
    averageReduction: avg,
  };
}
