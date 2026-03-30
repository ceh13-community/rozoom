import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const configurationSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);
const browserTabSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/common/port-forward-browser-tab.svelte"),
  "utf8",
);

describe("port-forward popout contract", () => {
  it("uses explicit preview action from tab toolbar", () => {
    expect(browserTabSource).toContain("Open Web");
    expect(configurationSource).toContain(
      "onOpenPreview={() => void openPortForwardTabInAppWindow(",
    );
  });

  it("auto-opens popout preview window from supported port-forward surfaces", () => {
    expect(configurationSource).toContain("void popOutPortForwardPreview(url);");
    expect(configurationSource).toContain("openPortForwardTabInAppWindow");
  });
});
