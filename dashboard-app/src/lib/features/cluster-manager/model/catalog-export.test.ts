import { describe, expect, it } from "vitest";
import { exportCatalog, importCatalog, applyCatalogToCluster } from "./catalog-export";
import type { AppClusterConfig } from "$entities/config";

describe("catalog-export", () => {
  const clusters: AppClusterConfig[] = [
    {
      uuid: "u1",
      name: "prod-us",
      displayName: "Production US",
      env: "prod",
      provider: "AWS EKS",
      tags: ["aws"],
      addedAt: new Date(),
    },
    { uuid: "u2", name: "dev-local", env: "dev", addedAt: new Date() },
  ];

  const groups = [{ id: "g1", name: "Production", collapsed: false }];
  const membership = { u1: "g1" };

  it("exports catalog without secrets", () => {
    const catalog = exportCatalog(clusters, groups, membership);

    expect(catalog.version).toBe(1);
    expect(catalog.clusters).toHaveLength(2);
    expect(catalog.clusters[0]?.name).toBe("prod-us");
    expect(catalog.clusters[0]?.displayName).toBe("Production US");
    expect(catalog.groups).toHaveLength(1);
    expect(catalog.groupMembership).toEqual({ u1: "g1" });
    // No uuid, addedAt, or other internal fields
    expect((catalog.clusters[0] as Record<string, unknown>).uuid).toBeUndefined();
    expect((catalog.clusters[0] as Record<string, unknown>).addedAt).toBeUndefined();
  });

  it("omits empty optional fields", () => {
    const catalog = exportCatalog(clusters, groups, membership);
    const devEntry = catalog.clusters[1]!;
    expect(devEntry.displayName).toBeUndefined();
    expect(devEntry.tags).toBeUndefined();
    expect(devEntry.provider).toBeUndefined();
  });

  it("imports valid catalog JSON", () => {
    const catalog = exportCatalog(clusters, groups, membership);
    const json = JSON.stringify(catalog);
    const result = importCatalog(json);

    expect(result.catalog).toBeDefined();
    expect(result.catalog!.clusters).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it("rejects invalid JSON", () => {
    const result = importCatalog("not json");
    expect(result.error).toContain("Failed to parse");
  });

  it("rejects unsupported version", () => {
    const result = importCatalog(JSON.stringify({ version: 99, clusters: [] }));
    expect(result.error).toContain("Unsupported catalog version");
  });

  it("applies catalog entry to existing cluster", () => {
    const existing: AppClusterConfig = { uuid: "u1", name: "prod-us", addedAt: new Date() };
    const updates = applyCatalogToCluster(existing, {
      name: "prod-us",
      displayName: "Prod US",
      env: "prod",
      tags: ["aws", "primary"],
    });

    expect(updates.displayName).toBe("Prod US");
    expect(updates.env).toBe("prod");
    expect(updates.tags).toEqual(["aws", "primary"]);
  });
});
