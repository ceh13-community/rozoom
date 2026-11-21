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

  it("resumes a reconnect with --since and merges by timestamp, like the workload logs", () => {
    expect(source).toContain("void startFollowStreamForTab(tabId, { resume: true });");
    expect(source).toContain("resumeSinceArg(tab.logsText, tab.logsUpdatedAt)");
    expect(source).toContain("createStreamChunkMerger({ resume: sinceArg !== null })");
    expect(source).toContain("applyResumeArgs(args, sinceArg);");
  });

  it("opens pod logs as a live stream with Previous off", () => {
    const open = source.slice(
      source.indexOf("async function openLogsForPod("),
      source.indexOf("async function openYamlForPod("),
    );
    expect(open).toContain("logsLive: true,");
    expect(open).toContain('logsMode: "stream-f",');
    expect(open).toContain("previousLogsAvailability(pod, container).available");
    expect(open).not.toContain("refreshLogsTab(");
    expect(source).toContain("openLogsForPod(pod, { previous: request.logsPrevious ?? false })");
  });

  it("never follows previous logs", () => {
    expect(source).toMatch(
      /function shouldKeepStreaming[\s\S]*?tab\.logsMode === "stream-f" && !tab\.logsPrevious/,
    );
  });
});
