import type { AppClusterConfig } from "$entities/config";

type SelectionMap = Record<string, boolean>;

type SelectAllOptions = {
  view: AppClusterConfig[];
  allSelected: boolean;
  previous?: SelectionMap;
};

export function buildManagedSelection({ view, allSelected, previous = {} }: SelectAllOptions) {
  const selection: SelectionMap = { ...previous, __all: allSelected };

  for (const cluster of view) {
    selection[cluster.uuid] = allSelected;
  }

  return selection;
}
