import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// set-draft-target.sh against a fake `gh` that keeps the release in a small state file.
// The case: RC3 built into the draft RC2 created; the draft still targeted RC2's commit.
const SCRIPT = path.resolve(__dirname, "set-draft-target.sh");

const FAKE_GH = `#!/usr/bin/env bash
state="$FAKE_STATE"
echo "$*" >> "$FAKE_LOG"
draft=$(sed -n 1p "$state"); target=$(sed -n 2p "$state")
if [ "$1 $2" = "release view" ]; then
  case "$*" in
    *isDraft*) echo "$draft" ;;
    *targetCommitish*) echo "$target" ;;
  esac
  exit 0
fi
if [ "$1 $2" = "release edit" ]; then
  for arg in "$@"; do
    if [ "$prev" = "--target" ]; then target="$arg"; fi
    prev="$arg"
  done
  printf '%s\\n%s\\n' "$draft" "$target" > "$state"
  exit 0
fi
exit 1
`;

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function run(draft: boolean, target: string, sha: string) {
  dir = mkdtempSync(path.join(tmpdir(), "draft-target-"));
  const bin = path.join(dir, "bin");
  execFileSync("mkdir", ["-p", bin]);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
  const state = path.join(dir, "state");
  const log = path.join(dir, "log");
  writeFileSync(state, `${draft}\n${target}\n`);
  writeFileSync(log, "");
  const output = execFileSync("bash", [SCRIPT, "app-v1.0.0", sha], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STATE: state, FAKE_LOG: log },
    encoding: "utf8",
  });
  const [, finalTarget] = readFileSync(state, "utf8").split("\n");
  return { output, finalTarget, calls: readFileSync(log, "utf8") };
}

describe("set-draft-target.sh", () => {
  it("points a draft that still targets the previous run at this run's commit", () => {
    const result = run(true, "bbf5be31", "1b09934b");
    expect(result.finalTarget).toBe("1b09934b");
    expect(result.calls).toContain("release edit app-v1.0.0 --draft=true --target 1b09934b");
    expect(result.output).toContain("now targets 1b09934b (was bbf5be31)");
  });

  it("leaves a published release alone", () => {
    const result = run(false, "bbf5be31", "1b09934b");
    expect(result.finalTarget).toBe("bbf5be31");
    expect(result.calls).not.toContain("release edit");
  });

  it("does nothing when the draft already targets the commit", () => {
    const result = run(true, "1b09934b", "1b09934b");
    expect(result.calls).not.toContain("release edit");
    expect(result.output).toContain("already targets 1b09934b");
  });
});
