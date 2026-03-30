import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configurationSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);
const resourceDetailsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/resource-details-sheet.svelte"),
  "utf8",
);
const sharedMetadataGridSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/common/details-metadata-grid.svelte"),
  "utf8",
);

describe("metadata expand reuse contract", () => {
  it("reuses shared key-value expand UI in configuration and workloads details", () => {
    expect(configurationSource).toContain(
      'import DetailsMetadataGrid from "./common/details-metadata-grid.svelte";',
    );
    expect(resourceDetailsSource).toContain(
      'import DetailsMetadataGrid from "./common/details-metadata-grid.svelte";',
    );
    expect(configurationSource).toContain("<DetailsMetadataGrid");
    expect(resourceDetailsSource).toContain("<DetailsMetadataGrid");
    expect(sharedMetadataGridSource).toContain(
      'import KeyValueExpand from "./key-value-expand.svelte";',
    );
    expect(sharedMetadataGridSource).toContain("<KeyValueExpand");
  });
});
