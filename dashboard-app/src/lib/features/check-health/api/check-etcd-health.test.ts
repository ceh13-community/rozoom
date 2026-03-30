import { describe, expect, it } from "vitest";
import {
  parseEtcdHealthOutput,
  parseEtcdMetrics,
  parseEtcdStatusOutput,
} from "./check-etcd-health";

describe("parseEtcdHealthOutput", () => {
  it("parses healthy and unhealthy endpoints with durations", () => {
    const output = `
https://10.0.0.1:2379 is healthy: successfully committed proposal: took = 2.15ms
https://10.0.0.2:2379 is unhealthy: failed to connect: context deadline exceeded
    `;
    const result = parseEtcdHealthOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ endpoint: "https://10.0.0.1:2379", ok: true });
    expect(result[0].tookMs).toBeCloseTo(2.15, 2);
    expect(result[1]).toMatchObject({ endpoint: "https://10.0.0.2:2379", ok: false });
    expect(result[1].error).toContain("unhealthy");
  });
});

describe("parseEtcdStatusOutput", () => {
  it("parses json status entries", () => {
    const output = JSON.stringify([
      {
        Endpoint: "https://10.0.0.1:2379",
        Status: {
          version: "3.5.9",
          dbSize: 1048576,
          leader: 2,
          raftIndex: 100,
          raftTerm: 4,
          header: { member_id: 2 },
        },
      },
    ]);
    const result = parseEtcdStatusOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      endpoint: "https://10.0.0.1:2379",
      version: "3.5.9",
      dbSizeBytes: 1048576,
      raftIndex: 100,
      raftTerm: 4,
      isLeader: true,
    });
  });
});

describe("parseEtcdMetrics", () => {
  it("extracts core metrics from /metrics output", () => {
    const output = `
# HELP etcd_server_has_leader Whether a leader exists
etcd_server_has_leader 1
etcd_server_leader_changes_seen_total 7
etcd_debugging_mvcc_db_total_size_in_bytes 4096
etcd_server_proposals_committed_total 123
    `;
    const result = parseEtcdMetrics(output, "etcd-0");
    expect(result).toMatchObject({
      endpoint: "etcd-0",
      hasLeader: 1,
      leaderChangesTotal: 7,
      dbSizeBytes: 4096,
      proposalsCommittedTotal: 123,
    });
  });
});
