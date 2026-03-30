import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pod-workbench-panel.svelte"),
  "utf8",
);

describe("pods stream reconnect contract", () => {
  it("keeps reconnect backoff for stream-f mode", () => {
    expect(source).toContain("const logsStreamReconnectMs = 1_200;");
    expect(source).toContain("function scheduleStreamReconnect(tabId: string)");
    expect(source).toContain("setTimeout(() => {");
    expect(source).toContain("void startFollowStreamForTab(tabId);");
    expect(source).toContain("Stream disconnected. Reconnecting...");
  });
});
