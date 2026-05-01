import { describe, expect, it } from "vitest";
import {
  buildBackupDirPath,
  buildMetadataFilename,
  buildResourceFilename,
  countYamlDocuments,
  formatTimestamp,
  parseBackupTimestamp,
  parseMetadataFile,
  sanitizeClusterName,
} from "./backup-paths";

describe("backup-paths", () => {
  it("sanitizes cluster name for filesystem", () => {
    expect(sanitizeClusterName("my-cluster")).toBe("my-cluster");
    expect(sanitizeClusterName("arn:aws:eks:us-east-1:123:cluster/prod")).toBe(
      "arn_aws_eks_us-east-1_123_cluster_prod",
    );
    expect(sanitizeClusterName("")).toBe("unknown-cluster");
    expect(sanitizeClusterName("a".repeat(100))).toHaveLength(80);
  });

  it("formats timestamp for directory name", () => {
    const date = new Date("2026-04-11T10:30:00.000Z");
    expect(formatTimestamp(date)).toBe("2026-04-11T10-30-00");
  });

  it("builds backup directory path", () => {
    const date = new Date("2026-04-11T10:30:00.000Z");
    expect(buildBackupDirPath("my-cluster", date)).toBe(
      "rozoom/backup/my-cluster/2026-04-11T10-30-00",
    );
  });

  it("builds resource filename with namespace", () => {
    expect(buildResourceFilename("deployments", "default")).toBe("default--deployments.yaml");
    expect(buildResourceFilename("clusterroles", null)).toBe("_cluster--clusterroles.yaml");
  });

  it("returns metadata filename", () => {
    expect(buildMetadataFilename()).toBe("_metadata.json");
  });

  it("parses backup timestamp from directory name", () => {
    const parsed = parseBackupTimestamp("2026-04-11T10-30-00");
    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe("2026-04-11T10:30:00.000Z");
  });

  it("returns null for invalid timestamp", () => {
    expect(parseBackupTimestamp("not-a-date")).toBeNull();
  });

  it("counts YAML documents", () => {
    expect(countYamlDocuments("")).toBe(0);
    expect(
      countYamlDocuments(
        "kind: Deployment\nmetadata:\n  name: app\n---\nkind: Service\nmetadata:\n  name: svc",
      ),
    ).toBe(2);
    expect(countYamlDocuments("kind: Pod\nmetadata:\n  name: p1")).toBe(1);
  });

  it("parses valid metadata file", () => {
    const meta = parseMetadataFile(
      JSON.stringify({
        version: 1,
        timestamp: "2026-04-11T10:30:00.000Z",
        clusterName: "test",
        clusterId: "123",
        scope: "full-cluster",
        namespaces: ["default"],
        resourceTypes: ["deployments"],
        files: [],
        errors: [],
      }),
    );
    expect(meta).not.toBeNull();
    expect(meta?.clusterName).toBe("test");
  });

  it("returns null for invalid metadata", () => {
    expect(parseMetadataFile("not json")).toBeNull();
    expect(parseMetadataFile(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseMetadataFile(JSON.stringify({ version: 1 }))).toBeNull();
  });
});
