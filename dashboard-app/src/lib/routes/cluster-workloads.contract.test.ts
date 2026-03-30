import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(resolve("src/routes/dashboard/clusters/[slug]/+page.ts"), "utf8");
const menuSource = readFileSync(resolve("src/lib/widgets/menu/ui/workloads.svelte"), "utf8");
const workloadRegistrySource = readFileSync(
  resolve("src/lib/widgets/workload/model/workload-route-registry.ts"),
  "utf8",
);

function extractValidWorkloads(source: string): string[] {
  const match = source.match(/const VALID_WORKLOADS = \[([\s\S]*?)\] as const;/);
  if (!match) return [];
  return [...match[1].matchAll(/"([a-z]+)"/g)].map((item) => item[1]);
}

function extractMenuWorkloads(source: string): string[] {
  return [...source.matchAll(/href:\s*"\?workload=([a-z]+)"/g)].map((item) => item[1]);
}

function extractMapKeys(source: string, mapName: string): string[] {
  const block = source.match(new RegExp(`const ${mapName}[^=]*= \\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!block) return [];
  return [...block[1].matchAll(/^\s*([a-z]+):/gm)].map((item) => item[1]);
}

describe("cluster workload routing contract", () => {
  const validWorkloads = extractValidWorkloads(routeSource);
  const menuWorkloads = extractMenuWorkloads(menuSource);
  const componentMapWorkloads = extractMapKeys(workloadRegistrySource, "workloadComponentLoaders");
  const propsMapWorkloads = extractMapKeys(workloadRegistrySource, "propsMap");

  it("keeps menu workloads aligned with route validator and workload component map", () => {
    for (const workload of menuWorkloads) {
      expect(validWorkloads).toContain(workload);
      expect(componentMapWorkloads).toContain(workload);
    }
  });

  it("keeps component and props maps aligned with route validator", () => {
    for (const workload of validWorkloads) {
      expect(componentMapWorkloads).toContain(workload);
      expect(propsMapWorkloads).toContain(workload);
    }
  });
});
