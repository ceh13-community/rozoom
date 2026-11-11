import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsListSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const dataTableSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/data-table.svelte"),
  "utf8",
);
const rowModelSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/model/pod-list-row.ts"),
  "utf8",
);

describe("pods list row cap contract", () => {
  it("builds table rows from every source pod, so NS filter, search, CSV and counters see the whole list", () => {
    expect(podsListSource).toContain(
      "const rows = $derived.by(() => createPodListRows(sourcePods));",
    );
    expect(podsListSource).not.toContain("PODS_SAFE_MODE_MAX_ROWS");
    expect(podsListSource).not.toContain("getPodsDisplaySlice");
  });

  it("caps only the grouped views, which render without pagination", () => {
    expect(rowModelSource).toContain("export const GROUPED_VIEW_MAX_ROWS = 400;");
    expect(dataTableSource).toContain(
      "const groupedViewRows = $derived(sortedRows.slice(0, GROUPED_VIEW_MAX_ROWS));",
    );
    expect(dataTableSource).toContain("for (const row of groupedViewRows) {");
  });

  it("selects only the pods the table reports after search and its NS checklist", () => {
    expect(podsListSource).toContain("let availableIds = $state<string[]>([]);");
    expect(podsListSource).toContain("onSelectableIdsChange={(ids, pageIds) => {");
    expect(podsListSource).toContain("availableIds = ids;");
    expect(podsListSource).toContain("selectedPodIds = new Set(availableIds);");
    expect(podsListSource).not.toContain("filteredRows.map((row) => row.uid)");
    expect(dataTableSource).toContain("onSelectableIdsChange(selectableIds, currentPageIds);");
  });

  it("warns in the delete and evict confirmations when the pods span pages", () => {
    expect(podsListSource).toContain(
      "describeOffPageSelection(podsToDelete.map(getPodUid), currentPageIds)",
    );
    expect(podsListSource).toContain(
      "describeOffPageSelection(podsToEvict.map(getPodUid), currentPageIds)",
    );
    expect(podsListSource).toContain("scopeNote={deleteDialogScopeNote}");
  });
});
