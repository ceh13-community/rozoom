import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);

describe("replication controllers list contract", () => {
  it("renders replicationcontroller status/spec fields inside the shared configuration shell", () => {
    expect(source).toContain('replicationcontrollers: "Replication Controllers"');
    expect(source).toContain('replicationcontrollers: "replicationcontrollers"');
    expect(source).toContain('workloadKey === "replicationcontrollers"');
    expect(source).toContain("Object.entries(asRecord(spec.selector))");
  });

  it("uses the shared workload-reference summary and runtime shell", () => {
    expect(source).toContain(
      'import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";',
    );
    expect(source).toContain("<MultiPaneWorkbench");
    expect(source).toContain("<ResourceSummaryStrip");
    expect(source).toContain("SectionRuntimeStatus");
    expect(source).toContain('secondaryActionLabel="Update"');
    expect(source).toContain(
      "const configurationRuntimeSectionLabel = $derived(`${tableTitle} Runtime Status`)",
    );
  });
});
