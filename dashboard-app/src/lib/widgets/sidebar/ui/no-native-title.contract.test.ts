import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WebKitGTK keeps a native title tooltip on screen after a click until the mouse moves:
// over the page a sidebar click opened, or with the old state text on a toggle. The
// sidebar and the workloads menu use the in-app hint (use:hint) instead.
const DIRS = ["../../sidebar/ui", "../../menu/ui", "../../../shared/ui/light-switch"];

describe("sidebar and menu use in-app hints", () => {
  it.each(
    DIRS.flatMap((dir) =>
      readdirSync(resolve(__dirname, dir))
        .filter((name) => name.endsWith(".svelte"))
        .map((name) => join(dir, name)),
    ),
  )("%s has no native title attribute", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    expect(source).not.toMatch(/\stitle=/);
  });
});
