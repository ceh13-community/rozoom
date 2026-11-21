import { beforeEach, describe, expect, it } from "vitest";
import {
  describeUnsavedWork,
  listUnsavedWork,
  navigationLeavesList,
  registerUnsavedWork,
  resetUnsavedWorkForTests,
} from "./unsaved-work";

const url = (path: string) => new URL(`tauri://localhost${path}`);

describe("unsaved work", () => {
  beforeEach(() => {
    resetUnsavedWorkForTests();
  });

  it("collects what the open lists would lose, until they are gone", () => {
    let tabs = ["YAML web"];
    const unregister = registerUnsavedWork(() => tabs);
    registerUnsavedWork(() => []);
    expect(listUnsavedWork()).toEqual(["YAML web"]);
    tabs = [];
    expect(listUnsavedWork()).toEqual([]);
    tabs = ["YAML api"];
    unregister();
    expect(listUnsavedWork()).toEqual([]);
  });

  it("asks only when the navigation replaces the list", () => {
    const deployments = url("/dashboard/clusters/c1?workload=deployments");
    expect(navigationLeavesList(deployments, url("/dashboard/clusters/c1?workload=pods"))).toBe(
      true,
    );
    expect(
      navigationLeavesList(deployments, url("/dashboard/clusters/c2?workload=deployments")),
    ).toBe(true);
    expect(navigationLeavesList(deployments, url("/dashboard"))).toBe(true);
    expect(
      navigationLeavesList(deployments, url("/dashboard/clusters/c1?workload=deployments&q=web")),
    ).toBe(false);
    expect(navigationLeavesList(null, deployments)).toBe(false);
  });

  it("names what will be lost", () => {
    expect(describeUnsavedWork(["YAML web"])).toBe(
      "Leave this page?\n\nYAML web\n\nUnsaved changes will be lost.",
    );
    expect(describeUnsavedWork(["1", "2", "3", "4", "5", "6", "7"])).toContain("5\nand 2 more");
  });
});
