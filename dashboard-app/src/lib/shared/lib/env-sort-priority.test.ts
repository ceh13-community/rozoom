import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  envSortPriority,
  getEnvSortIndex,
  compareClustersByEnv,
  DEFAULT_ENV_PRIORITY,
} from "./env-sort-priority";

beforeEach(() => {
  envSortPriority.set([...DEFAULT_ENV_PRIORITY]);
});

describe("getEnvSortIndex", () => {
  it("returns 0 for prod (first in defaults)", () => {
    expect(getEnvSortIndex("prod")).toBe(0);
  });

  it("returns index for known envs", () => {
    expect(getEnvSortIndex("prod")).toBeLessThan(getEnvSortIndex("dev"));
    expect(getEnvSortIndex("qual")).toBeLessThan(getEnvSortIndex("test"));
    expect(getEnvSortIndex("staging")).toBeLessThan(getEnvSortIndex("dev"));
  });

  it("returns high number for unknown envs", () => {
    expect(getEnvSortIndex("custom-env")).toBeGreaterThan(999);
  });

  it("returns 9999 for null/undefined", () => {
    expect(getEnvSortIndex(null)).toBe(9999);
    expect(getEnvSortIndex(undefined)).toBe(9999);
  });

  it("is case-insensitive", () => {
    expect(getEnvSortIndex("PROD")).toBe(getEnvSortIndex("prod"));
    expect(getEnvSortIndex("Dev")).toBe(getEnvSortIndex("dev"));
  });

  it("respects custom priority order", () => {
    envSortPriority.set(["dev", "test", "prod"]);
    expect(getEnvSortIndex("dev")).toBe(0);
    expect(getEnvSortIndex("test")).toBe(1);
    expect(getEnvSortIndex("prod")).toBe(2);
  });
});

describe("compareClustersByEnv", () => {
  it("sorts prod before dev", () => {
    const a = { env: "prod", name: "alpha", offline: false };
    const b = { env: "dev", name: "beta", offline: false };
    expect(compareClustersByEnv(a, b)).toBeLessThan(0);
  });

  it("sorts alphabetically within same env", () => {
    const a = { env: "prod", name: "beta", offline: false };
    const b = { env: "prod", name: "alpha", offline: false };
    expect(compareClustersByEnv(a, b)).toBeGreaterThan(0);
  });

  it("puts offline clusters last", () => {
    const a = { env: "prod", name: "alpha", offline: true };
    const b = { env: "dev", name: "beta", offline: false };
    expect(compareClustersByEnv(a, b)).toBeGreaterThan(0);
  });

  it("sorts a full fleet correctly", () => {
    const clusters = [
      { env: "dev", name: "dev-1", offline: false },
      { env: "prod", name: "prod-2", offline: false },
      { env: "test", name: "test-1", offline: false },
      { env: "prod", name: "prod-1", offline: false },
      { env: "staging", name: "staging-1", offline: false },
      { env: "dev", name: "dev-offline", offline: true },
    ];

    const sorted = [...clusters].sort(compareClustersByEnv);
    const order = sorted.map((c) => `${c.env}:${c.name}`);

    expect(order).toEqual([
      "prod:prod-1",
      "prod:prod-2",
      "staging:staging-1",
      "test:test-1",
      "dev:dev-1",
      "dev:dev-offline",
    ]);
  });

  it("handles unknown envs at the end", () => {
    const clusters = [
      { env: "custom", name: "c1", offline: false },
      { env: "prod", name: "p1", offline: false },
    ];
    const sorted = [...clusters].sort(compareClustersByEnv);
    expect(sorted[0].env).toBe("prod");
    expect(sorted[1].env).toBe("custom");
  });
});
