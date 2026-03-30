import { describe, expect, it } from "vitest";
import { applyResourceQuery, parseResourceQuery } from "./resource-query";

describe("resource-query", () => {
  it("parses field filters and free text", () => {
    const parsed = parseResourceQuery("ns:prod status!=running crash");
    expect(parsed.terms).toEqual([
      { field: "ns", operator: ":", value: "prod" },
      { field: "status", operator: "!=", value: "running" },
    ]);
    expect(parsed.freeText).toEqual(["crash"]);
  });

  it("applies numeric and text conditions", () => {
    const rows = [
      { name: "api", ns: "prod", restarts: 4, status: "CrashLoopBackOff" },
      { name: "web", ns: "prod", restarts: 0, status: "Running" },
    ];
    const parsed = parseResourceQuery("ns:prod restarts>1 status!=running");
    const result = applyResourceQuery(rows, parsed, (row) => `${row.name} ${row.ns} ${row.status}`);
    expect(result.map((row) => row.name)).toEqual(["api"]);
  });

  it("treats '=' and '!=' as exact text matches", () => {
    const rows = [
      { name: "a", status: "Running" },
      { name: "b", status: "Not-Running" },
      { name: "c", status: "Running-Old" },
    ];

    const equalsResult = applyResourceQuery(
      rows,
      parseResourceQuery("status=running"),
      (row) => row.status,
    );
    expect(equalsResult.map((row) => row.name)).toEqual(["a"]);

    const notEqualsResult = applyResourceQuery(
      rows,
      parseResourceQuery("status!=running"),
      (row) => row.status,
    );
    expect(notEqualsResult.map((row) => row.name)).toEqual(["b", "c"]);
  });
});
