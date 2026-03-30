import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn();
const getMock = vi.fn();
const hasMock = vi.fn();
const removeMock = vi.fn();
const clearMock = vi.fn();

vi.mock("tauri-plugin-cache-api", () => ({
  set: setMock,
  get: getMock,
  has: hasMock,
  remove: removeMock,
  clear: clearMock,
}));

describe("cache-provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes Set and Map values before writing cache", async () => {
    const { setCache } = await import("./cache-provider");

    await setCache("health_checks", {
      tags: new Set(["pods", "nodes"]),
      nested: new Map([["summary", new Set(["ok"])]]),
    });

    expect(setMock).toHaveBeenCalledWith("health_checks", {
      tags: ["pods", "nodes"],
      nested: {
        summary: ["ok"],
      },
    });
  });

  it("sanitizes Set and Map values before writing cache with ttl", async () => {
    const { setCacheWithTTL } = await import("./cache-provider");

    await setCacheWithTTL(
      "namespaces",
      {
        values: new Set(["default"]),
      },
      60,
    );

    expect(setMock).toHaveBeenCalledWith(
      "namespaces",
      {
        values: ["default"],
      },
      { ttl: 60 },
    );
  });
});
