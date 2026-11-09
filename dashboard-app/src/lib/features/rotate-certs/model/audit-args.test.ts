import { describe, expect, it } from "vitest";
import { buildAuditCreateArgs, buildAuditPatchArgs } from "./audit-args";

const target = {
  name: "rozoom-cert-rotation-audit",
  namespace: "kube-system",
  key: "entries.json",
};

// The CSR name that wiped a ConfigMap on the reviewer's stand (09/11/2026) when the
// audit arguments were a template string split on whitespace.
const HOSTILE_NAME = "z rev-wipe --patch='data': y";
const payload = JSON.stringify([
  { ts: "2026-11-09T08:00:00.000Z", action: "approve-all", detail: `approved=1 ${HOSTILE_NAME}` },
]);

describe("audit ConfigMap kubectl arguments", () => {
  it("patch: the whole JSON is one argument after exactly one -p", () => {
    const args = buildAuditPatchArgs(target, payload);

    expect(args.filter((a) => a === "-p")).toHaveLength(1);
    expect(args.filter((a) => a.startsWith("--patch"))).toHaveLength(0);
    const patch = args[args.indexOf("-p") + 1];
    expect(JSON.parse(patch)).toEqual({ data: { "entries.json": payload } });
    expect(args).toEqual([
      "patch",
      "configmap",
      "rozoom-cert-rotation-audit",
      "-n",
      "kube-system",
      "--type=merge",
      "-p",
      patch,
      "--request-timeout=10s",
    ]);
  });

  it("create: --from-literal carries the payload verbatim as one argument", () => {
    const args = buildAuditCreateArgs(target, payload);

    const literal = args.filter((a) => a.startsWith("--from-literal="));
    expect(literal).toHaveLength(1);
    expect(literal[0]).toBe(`--from-literal=entries.json=${payload}`);
    expect(args).toHaveLength(7);
    // The hostile name's "--patch=" lives inside that one element, never as its own flag.
    expect(args.filter((a) => a.startsWith("--patch"))).toHaveLength(0);
  });

  it("round-trips the hostile name through the patch JSON unchanged", () => {
    const args = buildAuditPatchArgs(target, payload);
    const patch = JSON.parse(args[args.indexOf("-p") + 1]) as { data: Record<string, string> };
    const entries = JSON.parse(patch.data["entries.json"]) as Array<{ detail: string }>;
    expect(entries[0]?.detail).toContain(HOSTILE_NAME);
  });
});
