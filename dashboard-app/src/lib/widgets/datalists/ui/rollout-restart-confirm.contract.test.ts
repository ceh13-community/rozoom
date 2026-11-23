import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every rollout restart asks first. The three restart functions must await
// confirmRolloutRestart for their kind before the first kubectl call, and leave on No.
// Dropping the question from any of them turns this red.
const RESTARTS = [
  {
    file: "deployments-list.svelte",
    fn: "async function rolloutAction(",
    kind: "deployment",
  },
  {
    file: "stateful-sets-list.svelte",
    fn: "async function restartStatefulSets(",
    kind: "statefulset",
  },
  {
    file: "daemon-sets-list.svelte",
    fn: "async function restartDaemonSets(",
    kind: "daemonset",
  },
];

function read(file: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", file), "utf8");
}

describe("rollout restart asks before it runs", () => {
  it.each(RESTARTS)("$file: $fn asks for $kind before kubectl", ({ file, fn, kind }) => {
    const source = read(file);
    const start = source.indexOf(fn);
    expect(start, `${fn} in ${file}`).toBeGreaterThan(-1);
    const body = source.slice(start);

    const question = body.indexOf(`await confirmRolloutRestart("${kind}", rolloutRestartTargets(`);
    const kubectl = body.indexOf("kubectlRawArgsFront(");
    expect(question, `question for ${kind} in ${fn}`).toBeGreaterThan(-1);
    expect(kubectl, `kubectl call in ${fn}`).toBeGreaterThan(-1);
    expect(question, "the question comes before the first kubectl call").toBeLessThan(kubectl);

    // The answer gates the call: a No returns before anything runs.
    const guard = body.slice(question - 40, question + 120);
    expect(guard).toMatch(/!\(await confirmRolloutRestart\(/);
    expect(body.slice(question, kubectl)).toMatch(/return;/);
  });
});
