import { beforeEach, describe, expect, it } from "vitest";
import { readJsonFromStorage, removeStorageKey, writeJsonToStorage } from "./local-storage";

describe("local-storage helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes and reads json values", () => {
    writeJsonToStorage("k1", { a: 1 });
    const value = readJsonFromStorage("k1", { fallback: { a: 0 } });
    expect(value).toEqual({ a: 1 });
  });

  it("migrates legacy key to new key", () => {
    window.localStorage.setItem("legacy", JSON.stringify({ a: 2 }));
    const value = readJsonFromStorage("k2", { fallback: { a: 0 }, migrateFromKeys: ["legacy"] });
    expect(value).toEqual({ a: 2 });
    expect(window.localStorage.getItem("legacy")).toBeNull();
    expect(window.localStorage.getItem("k2")).toBe(JSON.stringify({ a: 2 }));
  });

  it("returns fallback for malformed json", () => {
    window.localStorage.setItem("k3", "{bad}");
    const value = readJsonFromStorage("k3", { fallback: { a: 9 } });
    expect(value).toEqual({ a: 9 });
  });

  it("removes keys safely", () => {
    window.localStorage.setItem("k4", JSON.stringify({ a: 1 }));
    removeStorageKey("k4");
    expect(window.localStorage.getItem("k4")).toBeNull();
  });
});
