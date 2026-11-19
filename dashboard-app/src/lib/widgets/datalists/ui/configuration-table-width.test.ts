import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FIXED_COLUMN_PX,
  CONFIG_LEADING_COLUMNS_PX,
  CONFIG_SHARE_COLUMNS,
  configurationTableMinWidth,
} from "./configuration-table-width";

const SECRETS = {
  name: true,
  namespace: true,
  createdAt: true,
  keys: true,
  labels: true,
  type: true,
  resourceVersion: true,
};

function shareColumnPx(visible: Record<string, boolean>, column: string, tableWidth: number) {
  let fixed = CONFIG_LEADING_COLUMNS_PX;
  for (const [key, px] of Object.entries(CONFIG_FIXED_COLUMN_PX)) if (visible[key]) fixed += px;
  const percents = Object.entries(CONFIG_SHARE_COLUMNS)
    .filter(([key]) => visible[key])
    .reduce((sum, [, { percent }]) => sum + percent, 0);
  return ((tableWidth - fixed) * CONFIG_SHARE_COLUMNS[column].percent) / percents;
}

describe("configurationTableMinWidth", () => {
  // At a 1280 px window the Secrets table is about 914 px wide; the fixed columns took
  // 720 px of it and the Namespace and Age headers shrank to one letter.
  it("gives every shared column of the Secrets table room for its header", () => {
    const width = configurationTableMinWidth(SECRETS);
    expect(width).toBeGreaterThan(914);
    for (const column of ["name", "namespace", "createdAt"]) {
      expect(shareColumnPx(SECRETS, column, width)).toBeGreaterThanOrEqual(
        CONFIG_SHARE_COLUMNS[column].minPx,
      );
    }
  });

  it("stays below the 1280 px table width for ConfigMaps, so that table does not scroll", () => {
    const configMaps = {
      name: true,
      namespace: true,
      createdAt: true,
      keys: true,
      resourceVersion: true,
    };
    expect(configurationTableMinWidth(configMaps)).toBeLessThan(914);
  });

  it("counts only visible columns", () => {
    expect(configurationTableMinWidth({ name: true })).toBe(CONFIG_LEADING_COLUMNS_PX + 150);
    expect(configurationTableMinWidth({})).toBe(CONFIG_LEADING_COLUMNS_PX);
  });
});

describe("configuration table header widths", () => {
  const source = readFileSync(resolve(__dirname, "configuration-list.svelte"), "utf8");
  const start = source.indexOf('<Table.Table class="table-fixed"');
  const header = source.slice(start, source.indexOf("</Table.TableHeader>", start));
  const cells = [
    ...header.matchAll(
      /\{#if columnsVisible\.(\w+)\}\s*<Table\.TableHead class="w-\[(\d+)(px|%)\]"/g,
    ),
  ];

  it("matches the fixed px widths the minimum width is computed from", () => {
    const fixed = Object.fromEntries(
      cells.filter(([, , , unit]) => unit === "px").map(([, key, px]) => [key, Number(px)]),
    );
    expect(fixed).toEqual(CONFIG_FIXED_COLUMN_PX);
  });

  it("matches the shared percent widths", () => {
    const shared = Object.fromEntries(
      cells.filter(([, , , unit]) => unit === "%").map(([, key, pct]) => [key, Number(pct)]),
    );
    expect(shared).toEqual(
      Object.fromEntries(
        Object.entries(CONFIG_SHARE_COLUMNS).map(([key, { percent }]) => [key, percent]),
      ),
    );
  });

  it("applies the minimum width to the table", () => {
    expect(source.slice(start, start + 200)).toContain("configTableMinWidth");
  });

  it("cuts every sort header label inside its fixed column", () => {
    expect(header.match(/<SortingButton\b/g)?.length).toBeGreaterThan(0);
    expect(header).not.toMatch(/<SortingButton(?!\s+truncate\b)/);
  });
});

describe("custom resource definitions table header", () => {
  const source = readFileSync(
    resolve(__dirname, "custom-resources/custom-resources-list.svelte"),
    "utf8",
  );
  const start = source.indexOf('<Table.Table class="table-fixed');
  const header = source.slice(start, source.indexOf("</Table.TableHeader>", start));

  it("cuts every sort header label inside its fixed column", () => {
    expect(header.match(/<SortingButton\b/g)?.length).toBe(7);
    expect(header).not.toMatch(/<SortingButton(?!\s+truncate\b)/);
  });

  // The percent widths fit every header from 56rem of table width; below that the table
  // scrolls sideways instead of shrinking the columns.
  it("keeps the table at least 56rem wide and the percents at 100", () => {
    expect(source.slice(start, start + 60)).toContain("min-w-[56rem]");
    const percents = [...header.matchAll(/TableHead class="w-\[(\d+)%\]"/g)].map(([, p]) =>
      Number(p),
    );
    expect(percents.reduce((sum, p) => sum + p, 0)).toBe(100);
  });
});
