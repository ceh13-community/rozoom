import { describe, expect, it } from "vitest";
import { extractScalars } from "./prometheus-client";

describe("extractScalars", () => {
  it("returns empty array for null input (query failed)", () => {
    expect(extractScalars(null, ["pod"])).toEqual([]);
  });

  it("returns empty array when data.result is missing", () => {
    expect(extractScalars({ status: "success", data: {} }, ["pod"])).toEqual([]);
  });

  it("parses numeric sample values from each series", () => {
    const result = extractScalars(
      {
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { pod: "web-1", container: "app" },
              value: [1700000000, "12.5"],
            },
            {
              metric: { pod: "web-2", container: "app" },
              value: [1700000000, "7.2"],
            },
          ],
        },
      },
      ["pod", "container"],
    );
    expect(result).toEqual([
      { key: "web-1/app", tags: { pod: "web-1", container: "app" }, value: 12.5 },
      { key: "web-2/app", tags: { pod: "web-2", container: "app" }, value: 7.2 },
    ]);
  });

  it("skips series without a value field", () => {
    const result = extractScalars(
      {
        status: "success",
        data: { result: [{ metric: { pod: "x" } }] },
      },
      ["pod"],
    );
    expect(result).toEqual([]);
  });

  it("skips series with non-numeric values (NaN)", () => {
    const result = extractScalars(
      {
        status: "success",
        data: { result: [{ metric: { pod: "x" }, value: [0, "NaN"] }] },
      },
      ["pod"],
    );
    expect(result).toEqual([]);
  });

  it("fills missing labels with empty string and '-' in the key", () => {
    const result = extractScalars(
      {
        status: "success",
        data: { result: [{ metric: { pod: "x" }, value: [0, "1"] }] },
      },
      ["pod", "namespace"],
    );
    expect(result[0]).toEqual({
      key: "x/-",
      tags: { pod: "x", namespace: "" },
      value: 1,
    });
  });
});
