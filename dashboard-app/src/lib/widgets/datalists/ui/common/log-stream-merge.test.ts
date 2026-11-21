import { describe, expect, it } from "vitest";
import { createStreamChunkMerger, resumeSinceArg, trimLogText } from "./log-stream-merge";

function numbered(from: number, to: number) {
  return Array.from(
    { length: to - from + 1 },
    (_, offset) => `t${from + offset} line ${from + offset}\n`,
  ).join("");
}

describe("createStreamChunkMerger", () => {
  it("replaces the first-load tail with the fresh stream's first chunk, so 400 lines are not shown twice", () => {
    const merge = createStreamChunkMerger({ resume: false });
    // First load (kubectl logs --tail=400) already showed lines 1..400.
    let text = numbered(1, 400);
    // The follow stream starts with the same tail, then continues.
    text = merge(text, numbered(1, 400));
    text = merge(text, numbered(401, 402));

    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(402);
    expect(new Set(lines).size).toBe(402);
    expect(lines.at(-1)).toBe("t402 line 402");
  });

  it("keeps the text and appends only new lines when a stream resumes", () => {
    let clock = 0;
    const merge = createStreamChunkMerger({ resume: true, now: () => clock });
    let text = numbered(1, 500);
    // --since overlaps the last lines already shown.
    text = merge(text, numbered(495, 503));
    clock = 500;
    text = merge(text, numbered(504, 504));

    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(504);
    expect(new Set(lines).size).toBe(504);
    expect(lines[0]).toBe("t1 line 1");
  });

  it("stops dropping repeated lines once the overlap window has passed", () => {
    let clock = 0;
    const merge = createStreamChunkMerger({ resume: true, now: () => clock });
    let text = "ping\n";
    text = merge(text, "ping\n");
    clock = 10_000;
    text = merge(text, "ping\n");
    expect(text).toBe("ping\nping\n");
  });

  it("bounds the text on both paths", () => {
    const fresh = createStreamChunkMerger({ resume: false, maxChars: 50 });
    let text = fresh("", "x".repeat(40));
    text = fresh(text, "y".repeat(40));
    expect(text).toHaveLength(50);
    expect(text.endsWith("y".repeat(40))).toBe(true);

    let clock = 0;
    const resumed = createStreamChunkMerger({ resume: true, maxChars: 50, now: () => clock });
    text = resumed("a".repeat(45), "b".repeat(30));
    clock = 10_000;
    text = resumed(text, "c".repeat(30));
    expect(text).toHaveLength(50);
  });
});

describe("resumeSinceArg", () => {
  it("asks for the time the stream was down plus a margin", () => {
    expect(resumeSinceArg(10_000, 14_200)).toBe("--since=7s");
    expect(resumeSinceArg(null)).toBeNull();
  });
});

describe("trimLogText", () => {
  it("keeps the tail", () => {
    expect(trimLogText("abcdef", 3)).toBe("def");
    expect(trimLogText("abc", 3)).toBe("abc");
  });
});
