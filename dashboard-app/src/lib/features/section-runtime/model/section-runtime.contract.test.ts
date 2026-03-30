import { describe, expect, it } from "vitest";
import {
  CONFIGURATION_SECTION_WORKLOADS,
  NETWORK_SECTION_WORKLOADS,
  SECTION_RUNTIME_DESCRIPTORS,
  STORAGE_SECTION_WORKLOADS,
} from "./section-family-registry";

describe("section runtime contract", () => {
  it("keeps descriptors for all configuration/network/storage workloads", () => {
    const workloadKeys = [
      ...CONFIGURATION_SECTION_WORKLOADS,
      ...NETWORK_SECTION_WORKLOADS,
      ...STORAGE_SECTION_WORKLOADS,
    ];
    for (const workloadKey of workloadKeys) {
      expect(SECTION_RUNTIME_DESCRIPTORS[workloadKey]).toBeDefined();
    }
  });

  it("marks workbench-capable operational sections explicitly", () => {
    expect(SECTION_RUNTIME_DESCRIPTORS.services.supportsWorkbench).toBe(true);
    expect(SECTION_RUNTIME_DESCRIPTORS.persistentvolumeclaims.supportsWorkbench).toBe(true);
    expect(SECTION_RUNTIME_DESCRIPTORS.networkpolicies.supportsWorkbench).toBe(false);
    expect(SECTION_RUNTIME_DESCRIPTORS.configmaps.supportsWorkbench).toBe(false);
  });
});
