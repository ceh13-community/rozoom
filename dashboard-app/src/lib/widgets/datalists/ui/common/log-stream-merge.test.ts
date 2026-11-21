import { describe, expect, it } from "vitest";
import {
  applyResumeArgs,
  createStreamChunkMerger,
  parseLogLineTime,
  resumeSinceArg,
  trimLogText,
} from "./log-stream-merge";

function at(second: number, text: string) {
  const ss = String(second % 60).padStart(2, "0");
  const mm = String(Math.floor(second / 60)).padStart(2, "0");
  return `2026-11-21T12:${mm}:${ss}.123456789Z ${text}`;
}

function joinLines(lines: string[]) {
  return lines.map((line) => `${line}\n`).join("");
}

function lines(text: string) {
  return text.trimEnd().split("\n");
}

const HEALTHZ = "GET /healthz 200";
const REFUSED = "retry failed: connection refused";

describe("createStreamChunkMerger", () => {
  it("replaces the first-load tail with a fresh stream's first chunk, so 400 lines are not shown twice", () => {
    const merge = createStreamChunkMerger({ resume: false });
    const tail = Array.from({ length: 400 }, (_, index) => at(index, `line ${index}`));
    let text = joinLines(tail);
    text = merge(text, joinLines(tail));
    text = merge(text, joinLines([at(400, "line 400")]));

    expect(lines(text)).toHaveLength(401);
    expect(new Set(lines(text)).size).toBe(401);
  });

  it("keeps repeated new lines of a resumed stream (timestamps cut the overlap)", () => {
    // Shown: 20 health checks, then one refused retry.
    const shown = [
      ...Array.from({ length: 20 }, (_, index) => at(index, HEALTHZ)),
      at(20, REFUSED),
    ];
    // Resumed with --since: the last 3 shown lines, then 10 new ones during the outage.
    const fresh = [
      ...Array.from({ length: 4 }, (_, index) => at(21 + index, HEALTHZ)),
      at(25, REFUSED),
      ...Array.from({ length: 4 }, (_, index) => at(26 + index, HEALTHZ)),
      at(30, REFUSED),
    ];
    let clock = 0;
    const merge = createStreamChunkMerger({ resume: true, now: () => clock });
    let text = joinLines(shown);
    for (const line of [...shown.slice(-3), ...fresh]) {
      text = merge(text, `${line}\n`);
      clock += 10;
    }

    expect(lines(text)).toEqual([...shown, ...fresh]);
    expect(lines(text).filter((line) => line.endsWith(REFUSED))).toHaveLength(3);
  });

  it("does not drop new lines of a resumed stream whose text repeats the shown lines (no timestamps)", () => {
    // The case above without timestamps: nothing can tell overlap from new
    // lines, so the resumed stream replaces the text instead of losing lines.
    const shown = [...Array.from({ length: 20 }, () => HEALTHZ), REFUSED];
    const resumed = [
      HEALTHZ,
      HEALTHZ,
      REFUSED,
      ...Array.from({ length: 4 }, () => HEALTHZ),
      REFUSED,
      ...Array.from({ length: 4 }, () => HEALTHZ),
      REFUSED,
    ];
    let clock = 0;
    const merge = createStreamChunkMerger({ resume: true, now: () => clock });
    let text = joinLines(shown);
    for (const line of resumed) {
      text = merge(text, `${line}\n`);
      clock += 10;
    }

    expect(lines(text)).toEqual(resumed);
    expect(
      lines(text)
        .slice(3)
        .filter((line) => line === REFUSED),
    ).toHaveLength(2);
  });

  it("drops lines at the latest shown instant only as often as they are shown", () => {
    const merge = createStreamChunkMerger({ resume: true, now: () => 0 });
    const shown = joinLines([at(1, "a"), at(2, "x"), at(2, "x")]);
    const text = merge(
      shown,
      joinLines([at(1, "a"), at(2, "x"), at(2, "x"), at(2, "x"), at(3, "b")]),
    );

    expect(lines(text)).toEqual([at(1, "a"), at(2, "x"), at(2, "x"), at(2, "x"), at(3, "b")]);
  });

  it("reads the timestamp after a --prefix pod tag", () => {
    const merge = createStreamChunkMerger({ resume: true, now: () => 0 });
    const shown = joinLines([`[pod/web-1/app] ${at(5, "old")}`]);
    const text = merge(
      shown,
      joinLines([`[pod/web-1/app] ${at(5, "old")}`, `[pod/web-2/app] ${at(6, "new")}`]),
    );

    expect(lines(text)).toEqual([
      `[pod/web-1/app] ${at(5, "old")}`,
      `[pod/web-2/app] ${at(6, "new")}`,
    ]);
  });

  it("appends without filtering once the overlap window has passed", () => {
    let clock = 0;
    const merge = createStreamChunkMerger({ resume: true, now: () => clock });
    let text = joinLines([at(10, "x")]);
    text = merge(text, joinLines([at(11, "y")]));
    clock = 10_000;
    text = merge(text, joinLines([at(9, "late line from another pod")]));
    expect(lines(text)).toHaveLength(3);
  });

  it("bounds the text on both paths", () => {
    const fresh = createStreamChunkMerger({ resume: false, maxChars: 50 });
    let text = fresh("", "x".repeat(40));
    text = fresh(text, "y".repeat(40));
    expect(text).toHaveLength(50);

    const resumed = createStreamChunkMerger({ resume: true, maxChars: 80, now: () => 0 });
    text = resumed(joinLines([at(1, "a".repeat(40))]), joinLines([at(2, "b".repeat(40))]));
    expect(text.length).toBeLessThanOrEqual(80);
    expect(text.endsWith(`${"b".repeat(40)}\n`)).toBe(true);
  });
});

describe("resumeSinceArg", () => {
  const shown = joinLines([at(1, "a")]);

  it("asks for the time the stream was down plus a margin", () => {
    expect(resumeSinceArg(shown, 10_000, 14_200)).toBe("--since=7s");
  });

  it("starts fresh without text, without timestamps or after a long outage", () => {
    expect(resumeSinceArg("", 10_000, 14_200)).toBeNull();
    expect(resumeSinceArg("plain line\n", 10_000, 14_200)).toBeNull();
    expect(resumeSinceArg(shown, null, 14_200)).toBeNull();
    expect(resumeSinceArg(shown, 1, 6 * 60_000)).toBeNull();
  });
});

describe("applyResumeArgs", () => {
  it("drops --tail so the whole outage comes back, and adds --since", () => {
    const args = ["logs", "deployment/web", "--tail=400", "--timestamps=true", "-f"];
    applyResumeArgs(args, "--since=7s");
    expect(args).toEqual(["logs", "deployment/web", "--timestamps=true", "-f", "--since=7s"]);

    const fresh = ["logs", "--tail=400"];
    applyResumeArgs(fresh, null);
    expect(fresh).toEqual(["logs", "--tail=400"]);
  });
});

describe("parseLogLineTime / trimLogText", () => {
  it("parses kubectl timestamps with and without fractions", () => {
    expect(parseLogLineTime("2026-11-21T12:00:01Z hello")).toEqual({
      seconds: Date.parse("2026-11-21T12:00:01Z") / 1000,
      nanos: 0,
    });
    expect(parseLogLineTime("2026-11-21T12:00:01.5Z hello")?.nanos).toBe(500_000_000);
    expect(parseLogLineTime("hello")).toBeNull();
  });

  it("keeps the tail", () => {
    expect(trimLogText("abcdef", 3)).toBe("def");
    expect(trimLogText("abc", 3)).toBe("abc");
  });
});
