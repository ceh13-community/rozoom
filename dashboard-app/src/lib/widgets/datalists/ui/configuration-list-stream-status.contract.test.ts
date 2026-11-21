import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);

describe("configuration list stream status contract", () => {
  it("calls a stream-mode list live only while its stream is live", () => {
    expect(source).toContain('if (configurationStreamLive) return "live";');
    expect(source).toContain(
      'if (lastWatcherSuccessAt && watcherPolicy.mode !== "stream") return "live";',
    );
    expect(source).not.toContain(
      'if (configurationStreamLive || lastWatcherSuccessAt) return "live";',
    );
  });
});
