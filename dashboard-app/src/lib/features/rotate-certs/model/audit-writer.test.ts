import { describe, expect, it } from "vitest";
import { createAuditWriter, type AuditEntry } from "./audit-writer";

const entry = (action: string): AuditEntry => ({
  ts: "2026-11-09T10:00:00.000Z",
  action,
  detail: action,
});

const actionsOf = (payload: string) =>
  (JSON.parse(payload) as AuditEntry[]).map((e) => e.action).join(",");

/**
 * A ConfigMap stand-in with the API server's rules: PATCH fails while the object is
 * missing, CREATE fails once it exists (AlreadyExists). `calls` is the order kubectl saw.
 * Each call yields once, so unserialised appends interleave the way they did in the app.
 */
function fakeCluster(initial: AuditEntry[] | null) {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  let log: AuditEntry[] = initial ? initial.slice().reverse() : [];
  const calls: string[] = [];
  return {
    calls,
    stored: () => (stored === null ? null : (JSON.parse(stored) as AuditEntry[])),
    deps: {
      readLog: () => log,
      patch: async (payload: string) => {
        await Promise.resolve();
        calls.push(`patch:${actionsOf(payload)}`);
        if (stored === null) return { code: 1, errors: "configmaps not found" };
        stored = payload;
        return { code: 0, errors: "" };
      },
      create: async (payload: string) => {
        await Promise.resolve();
        calls.push(`create:${actionsOf(payload)}`);
        if (stored !== null) return { code: 1, errors: "configmaps already exists" };
        stored = payload;
        return { code: 0, errors: "" };
      },
      // Like fetchAuditLog: read back what the cluster holds, newest first.
      onWritten: async () => {
        log = stored === null ? [] : (JSON.parse(stored) as AuditEntry[]).slice().reverse();
      },
    },
  };
}

describe("audit writer queue", () => {
  it("first run: two concurrent appends create once, then patch; both entries are stored", async () => {
    const cluster = fakeCluster(null);
    const writer = createAuditWriter(cluster.deps);

    const [approve, rotate] = await Promise.all([
      writer.append(entry("approve-all")),
      writer.append(entry("rotate")),
    ]);

    expect(approve).toEqual({ ok: true });
    expect(rotate).toEqual({ ok: true });
    expect(cluster.calls).toEqual([
      "patch:approve-all",
      "create:approve-all",
      "patch:approve-all,rotate",
    ]);
    expect(cluster.stored()?.map((e) => e.action)).toEqual(["approve-all", "rotate"]);
  });

  it("existing ConfigMap: the second payload builds on the first write, not on the log at enqueue time", async () => {
    const cluster = fakeCluster([entry("older")]);
    const writer = createAuditWriter(cluster.deps);

    await Promise.all([writer.append(entry("approve-all")), writer.append(entry("rotate"))]);

    expect(cluster.calls).toEqual(["patch:older,approve-all", "patch:older,approve-all,rotate"]);
    expect(cluster.stored()?.map((e) => e.action)).toEqual(["older", "approve-all", "rotate"]);
  });

  it("a create that fails is reported as such and does not block the next entry", async () => {
    const cluster = fakeCluster(null);
    const writer = createAuditWriter({
      ...cluster.deps,
      create: (payload) =>
        payload.includes("doomed")
          ? Promise.resolve({ code: 1, errors: "forbidden" })
          : cluster.deps.create(payload),
    });

    const [doomed, rotate] = await Promise.all([
      writer.append(entry("doomed")),
      writer.append(entry("rotate")),
    ]);

    expect(doomed).toEqual({ ok: false, stage: "create", message: "forbidden" });
    expect(rotate).toEqual({ ok: true });
    // The doomed create is answered by the wrapper above, so the cluster never saw it.
    expect(cluster.calls).toEqual(["patch:doomed", "patch:rotate", "create:rotate"]);
    expect(cluster.stored()?.map((e) => e.action)).toEqual(["rotate"]);
  });

  it("a kubectl call that throws is reported as an error and the queue goes on", async () => {
    const cluster = fakeCluster([entry("older")]);
    const writer = createAuditWriter({
      ...cluster.deps,
      patch: (payload) =>
        payload.includes("boom") ? Promise.reject(new Error("boom")) : cluster.deps.patch(payload),
    });

    const [boom, rotate] = await Promise.all([
      writer.append(entry("boom")),
      writer.append(entry("rotate")),
    ]);

    expect(boom).toEqual({ ok: false, stage: "error", message: "boom" });
    expect(rotate).toEqual({ ok: true });
    expect(cluster.stored()?.map((e) => e.action)).toEqual(["older", "rotate"]);
  });

  it("keeps only the newest maxEntries in the payload", async () => {
    const cluster = fakeCluster([entry("a"), entry("b")]);
    const writer = createAuditWriter({ ...cluster.deps, maxEntries: 2 });

    await writer.append(entry("c"));

    expect(cluster.calls).toEqual(["patch:b,c"]);
  });
});
