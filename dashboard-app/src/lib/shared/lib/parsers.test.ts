import { describe, expect, it } from "vitest";
import { checkResponseStatus } from "./parsers";

describe("checkResponseStatus", () => {
  it("returns 0 for auth errors", () => {
    expect(checkResponseStatus("Unauthorized")).toBe(0);
    expect(checkResponseStatus("Forbidden")).toBe(0);
  });

  it("returns -1 for not found errors", () => {
    expect(checkResponseStatus("NotFound")).toBe(-1);
    expect(checkResponseStatus("404")).toBe(-1);
  });

  it("returns 2 for timeout errors", () => {
    expect(checkResponseStatus("request timeout")).toBe(2);
  });

  it("returns 0 for tls/x509 certificate errors", () => {
    expect(checkResponseStatus("tls: failed to verify certificate")).toBe(0);
    expect(checkResponseStatus("x509: cannot validate certificate")).toBe(0);
  });

  it("returns 0 for unknown errors to avoid false green", () => {
    expect(checkResponseStatus("connection refused")).toBe(0);
  });
});
