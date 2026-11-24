import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildSilenceCurlCommand, shellSingleQuote, type SilenceDraft } from "./silence-curl";

const NOW = new Date("2026-11-24T12:00:00.000Z");

function draft(overrides: Partial<SilenceDraft> = {}): SilenceDraft {
  return {
    alertname: "KubePodCrashLooping",
    namespace: "",
    durationHours: 4,
    author: "ops",
    comment: "",
    extraMatchers: [],
    ...overrides,
  };
}

/** The -d argument exactly as a POSIX shell would pass it to curl. */
function payloadAsShellSeesIt(command: string): string {
  const quoted = command
    .split("\n")
    .at(-1)!
    .replace(/^ {2}-d /, "");
  return execFileSync("sh", ["-c", `printf '%s' ${quoted}`], { encoding: "utf8" });
}

describe("shellSingleQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellSingleQuote("abc")).toBe("'abc'");
  });

  it("closes, escapes and reopens around a single quote", () => {
    expect(shellSingleQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("buildSilenceCurlCommand", () => {
  it("posts the matchers, window and author to the Alertmanager API", () => {
    const command = buildSilenceCurlCommand(draft({ namespace: "shop" }), NOW);
    expect(command).toContain("curl -X POST http://localhost:9093/api/v2/silences");
    expect(JSON.parse(payloadAsShellSeesIt(command))).toEqual({
      matchers: [
        { name: "alertname", value: "KubePodCrashLooping", isRegex: false },
        { name: "namespace", value: "shop", isRegex: false },
      ],
      startsAt: "2026-11-24T12:00:00.000Z",
      endsAt: "2026-11-24T16:00:00.000Z",
      createdBy: "ops",
      comment: "",
    });
  });

  it("keeps a quote from the cluster inside the payload instead of running it", () => {
    const injected = "x'; echo INJECTED; echo '";
    const command = buildSilenceCurlCommand(
      draft({ alertname: injected, extraMatchers: [{ name: "team", value: "a'b" }] }),
      NOW,
    );
    const payload = JSON.parse(payloadAsShellSeesIt(command));
    expect(payload.matchers[0].value).toBe(injected);
    expect(payload.matchers[1]).toEqual({ name: "team", value: "a'b", isRegex: false });
  });

  it.each([
    ["command substitution", "$(echo INJECTED)"],
    ["backticks", "`echo INJECTED`"],
    ["a backslash", "a\\'b\\"],
    ["a newline", "line1\n'; echo INJECTED; echo '\nline2"],
    ["everything at once", "`x` $(y) ${z} \\ ' \" \n\t; | & > <"],
  ])("passes %s to curl as text", (_case, value) => {
    const command = buildSilenceCurlCommand(
      draft({ alertname: value, namespace: value, comment: value }),
      NOW,
    );
    const shellSees = payloadAsShellSeesIt(command);
    expect(shellSees).not.toContain("\nINJECTED");
    const payload = JSON.parse(shellSees);
    expect(payload.matchers[0].value).toBe(value);
    expect(payload.matchers[1].value).toBe(value);
    expect(payload.comment).toBe(value);
  });
});
