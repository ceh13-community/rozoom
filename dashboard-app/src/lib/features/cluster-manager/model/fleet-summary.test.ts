import { describe, expect, it } from "vitest";
import type { AppClusterConfig } from "$entities/config/";
import { bucketCluster, buildFleetSummary, fleetSummaryHeadline } from "./fleet-summary";

function cluster(partial: Partial<AppClusterConfig>): AppClusterConfig {
  return {
    uuid: partial.uuid ?? crypto.randomUUID(),
    name: partial.name ?? "c",
    addedAt: partial.addedAt ?? new Date(),
    ...partial,
  };
}

describe("bucketCluster", () => {
  it("marks auth error when state.error mentions Unauthorized", () => {
    const c = cluster({ name: "eks" });
    expect(bucketCluster(c, { error: "error: Unauthorized" }, null)).toBe("auth-error");
    expect(bucketCluster(c, { error: "status 401" }, null)).toBe("auth-error");
    expect(bucketCluster(c, { error: "token has expired" }, null)).toBe("auth-error");
  });

  it("marks offline on connection error", () => {
    const c = cluster({ name: "eks" });
    expect(bucketCluster(c, { error: "dial tcp 10.0.0.1:6443 connection refused" }, null)).toBe(
      "offline",
    );
    expect(bucketCluster(c, { error: "request timeout" }, null)).toBe("offline");
  });

  it("marks offline on Go context.DeadlineExceeded and similar kubectl phrasings", () => {
    const c = cluster({ name: "eks" });
    expect(
      bucketCluster(
        c,
        { error: "Unable to connect to the server: context deadline exceeded" },
        null,
      ),
    ).toBe("offline");
    expect(
      bucketCluster(c, { error: "Unable to connect to the server: server misbehaving" }, null),
    ).toBe("offline");
    expect(bucketCluster(c, { error: "read tcp 10.0.0.1:6443: i/o timeout" }, null)).toBe(
      "offline",
    );
  });

  it("respects cluster.offline flag", () => {
    expect(bucketCluster(cluster({ offline: true }), undefined, null)).toBe("offline");
  });

  it("marks critical when any check is critical", () => {
    const c = cluster({ name: "k" });
    const health = { apiServerHealth: { status: "ok" }, etcdHealth: { status: "critical" } };
    expect(bucketCluster(c, undefined, health)).toBe("critical");
  });

  it("marks warning when no critical but some warning", () => {
    const c = cluster({ name: "k" });
    const health = { apiServerHealth: { status: "ok" }, podIssues: { status: "warning" } };
    expect(bucketCluster(c, undefined, health)).toBe("warning");
  });

  it("marks online when all checks ok", () => {
    const c = cluster({ name: "k" });
    const health = { apiServerHealth: { status: "ok" }, etcdHealth: { status: "ok" } };
    expect(bucketCluster(c, undefined, health)).toBe("online");
  });

  it("marks unknown when health record carries errors field", () => {
    const c = cluster({ name: "k" });
    expect(bucketCluster(c, undefined, { errors: "scan failed" })).toBe("unknown");
  });

  it("falls back to cluster.status when no other signal", () => {
    expect(bucketCluster(cluster({ status: "ok" }), undefined, null)).toBe("online");
    expect(bucketCluster(cluster({ status: "error" }), undefined, null)).toBe("offline");
    expect(bucketCluster(cluster({}), undefined, null)).toBe("unknown");
  });

  it("auth error takes priority over offline signal", () => {
    const c = cluster({ offline: true });
    expect(bucketCluster(c, { error: "Unauthorized" }, null)).toBe("auth-error");
  });
});

describe("buildFleetSummary", () => {
  it("returns zero summary for empty fleet", () => {
    const s = buildFleetSummary({ clusters: [] });
    expect(s.total).toBe(0);
    expect(s.online).toBe(0);
    expect(s.envBreakdown).toEqual({});
  });

  it("counts online/offline/auth-error correctly", () => {
    const clusters = [
      cluster({ uuid: "1", name: "ok-1" }),
      cluster({ uuid: "2", name: "ok-2" }),
      cluster({ uuid: "3", name: "down" }),
      cluster({ uuid: "4", name: "creds" }),
    ];
    const summary = buildFleetSummary({
      clusters,
      states: {
        "3": { error: "dial tcp connection refused" },
        "4": { error: "status 403 Forbidden" },
      },
      health: {
        "1": { apiServerHealth: { status: "ok" } },
        "2": { apiServerHealth: { status: "ok" } },
      },
    });
    expect(summary.total).toBe(4);
    expect(summary.online).toBe(2);
    expect(summary.offline).toBe(1);
    expect(summary.authErrors).toBe(1);
  });

  it("groups critical and warning separately but counts them as online", () => {
    const clusters = [cluster({ uuid: "1" }), cluster({ uuid: "2" }), cluster({ uuid: "3" })];
    const summary = buildFleetSummary({
      clusters,
      health: {
        "1": { apiServerHealth: { status: "ok" } },
        "2": { etcdHealth: { status: "warning" } },
        "3": { podIssues: { status: "critical" } },
      },
    });
    expect(summary.online).toBe(3);
    expect(summary.warning).toBe(1);
    expect(summary.critical).toBe(1);
  });

  it("builds env and provider breakdown via callbacks", () => {
    const clusters = [
      cluster({ uuid: "1", name: "prod-a" }),
      cluster({ uuid: "2", name: "prod-b" }),
      cluster({ uuid: "3", name: "staging-x" }),
    ];
    const summary = buildFleetSummary({
      clusters,
      envFor: (c) => (c.name.startsWith("prod") ? "prod" : "staging"),
      providerFor: () => "EKS",
    });
    expect(summary.envBreakdown).toEqual({ prod: 2, staging: 1 });
    expect(summary.providerBreakdown).toEqual({ EKS: 3 });
  });

  it("lowercases env labels and coalesces blank env to 'other'", () => {
    const clusters = [cluster({ uuid: "1" }), cluster({ uuid: "2" })];
    const summary = buildFleetSummary({
      clusters,
      envFor: (c) => (c.uuid === "1" ? "Prod" : ""),
    });
    expect(summary.envBreakdown).toEqual({ prod: 1, other: 1 });
  });
});

describe("fleetSummaryHeadline", () => {
  it("shows empty state", () => {
    expect(fleetSummaryHeadline(buildFleetSummary({ clusters: [] }))).toBe(
      "No clusters connected yet",
    );
  });

  it("produces the expected headline", () => {
    const clusters = [
      cluster({ uuid: "1", name: "prod-1" }),
      cluster({ uuid: "2", name: "prod-2" }),
      cluster({ uuid: "3", name: "stage-1" }),
      cluster({ uuid: "4", name: "down" }),
    ];
    const line = fleetSummaryHeadline(
      buildFleetSummary({
        clusters,
        states: { "4": { error: "dial tcp connection refused" } },
        health: {
          "1": { apiServerHealth: { status: "ok" } },
          "2": { apiServerHealth: { status: "ok" } },
          "3": { apiServerHealth: { status: "ok" } },
        },
        envFor: (c) =>
          c.name.startsWith("prod") ? "prod" : c.name.startsWith("stage") ? "stage" : "other",
      }),
    );
    expect(line).toContain("3/4 online");
    expect(line).toContain("1 offline");
    expect(line).toContain("2 prod");
    expect(line).toContain("1 stage");
  });

  it("pluralises auth issue label correctly", () => {
    const s = { ...buildFleetSummary({ clusters: [] }), total: 5, online: 3, authErrors: 1 };
    expect(fleetSummaryHeadline(s)).toContain("1 auth issue");
    expect(fleetSummaryHeadline({ ...s, authErrors: 3 })).toContain("3 auth issues");
  });
});
