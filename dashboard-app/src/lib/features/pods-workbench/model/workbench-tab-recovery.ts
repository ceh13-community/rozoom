export type RecoverableWorkbenchTab<TKind extends string = string> = {
  id: string;
  kind: TKind;
  title: string;
  subtitle: string;
};

type RecoveryInput<TKind extends string> = {
  currentTabs: RecoverableWorkbenchTab<TKind>[];
  candidates: RecoverableWorkbenchTab<TKind>[];
  activeTabId: string | null;
};

type RecoveryOutput<TKind extends string> = {
  tabs: RecoverableWorkbenchTab<TKind>[];
  activeTabId: string | null;
};

export function recoverWorkbenchTabs<TKind extends string>(
  input: RecoveryInput<TKind>,
): RecoveryOutput<TKind> | null {
  if (input.currentTabs.length > 0) return null;
  if (input.candidates.length === 0) return null;

  const seen = new Set<string>();
  const tabs: RecoverableWorkbenchTab<TKind>[] = [];
  for (const candidate of input.candidates) {
    if (!candidate.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    tabs.push(candidate);
  }
  if (tabs.length === 0) return null;

  const activeTabId =
    input.activeTabId && tabs.some((tab) => tab.id === input.activeTabId)
      ? input.activeTabId
      : tabs[0].id;

  return {
    tabs,
    activeTabId,
  };
}
