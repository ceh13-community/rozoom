import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findAnchoredLineIndex } from "./log-scroll-anchor";

function numbered(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, offset) => `line ${from + offset}`);
}

describe("findAnchoredLineIndex", () => {
  it("keeps the index when lines are only appended", () => {
    expect(findAnchoredLineIndex(numbered(1, 400), numbered(1, 410), 120)).toBe(120);
  });

  it("follows the top line when a poll slides the tail window", () => {
    // Before: lines 1..400, reader at line 121. After: the latest 400 are 11..410.
    expect(findAnchoredLineIndex(numbered(1, 400), numbered(11, 410), 120)).toBe(110);
  });

  it("uses the following lines to tell repeated lines apart", () => {
    const previous = ["", "a", "", "b", "", "c", "", "d"];
    const next = ["", "b", "", "c", "", "d", "", "e"];
    // Top line is the blank before "c".
    expect(findAnchoredLineIndex(previous, next, 4)).toBe(2);
  });

  it("goes to the top when the anchored line left the retained text", () => {
    expect(findAnchoredLineIndex(numbered(1, 400), numbered(500, 899), 10)).toBe(0);
  });

  it("returns null when there is nothing to anchor", () => {
    expect(findAnchoredLineIndex([], numbered(1, 3), 0)).toBeNull();
    expect(findAnchoredLineIndex(numbered(1, 3), [], 0)).toBeNull();
    expect(findAnchoredLineIndex(numbered(1, 3), numbered(1, 3), 5)).toBeNull();
  });
});

describe("workload logs defaults", () => {
  const lists = [
    "deployments-list.svelte",
    "daemon-sets-list.svelte",
    "stateful-sets-list.svelte",
    "replica-sets-list.svelte",
    "jobs-list.svelte",
    "cron-jobs-list.svelte",
  ];

  it.each(lists)(
    "%s streams through the shared bounded merger and resumes on reconnect",
    (file) => {
      const source = readFileSync(resolve("src/lib/widgets/datalists/ui", file), "utf8");
      expect(source).toContain('logsMode: "stream-f",');
      expect(source).not.toContain('logsMode: "poll",');
      // Every stream chunk goes through the merger, which trims to LOG_TEXT_MAX_CHARS.
      expect(source).toContain(
        "const mergeChunk = createStreamChunkMerger({ resume: sinceArg !== null });",
      );
      expect(source).toContain("logsText: mergeChunk(current.logsText, chunk),");
      expect(source).not.toMatch(/logsText: `\$\{current\.logsText\}\$\{chunk\}`/);
      // A reconnect resumes with --since instead of replacing the text.
      expect(source).toContain("void startFollowStreamForTab(tabId, { resume: true });");
      expect(source).toContain("applyResumeArgs(args, sinceArg);");
      expect(source).toContain(
        "options.resume ? resumeSinceArg(tab.logsText, tab.logsUpdatedAt) : null",
      );
      // A follow stream must not carry a request timeout: it cuts the stream.
      const streamStart = source.indexOf("async function startFollowStreamForTab(");
      const streamBody = source.slice(streamStart, source.indexOf("onStdoutData", streamStart));
      expect(streamBody).not.toContain("--request-timeout");
    },
  );
});
