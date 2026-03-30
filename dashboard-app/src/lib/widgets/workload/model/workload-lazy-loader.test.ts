import { describe, expect, it } from "vitest";
import {
  isRecoverableWorkloadImportError,
  resolveWorkloadComponentExport,
  shouldReloadAfterWorkloadImportFailure,
} from "./workload-lazy-loader";

describe("workload-lazy-loader", () => {
  it("recognizes recoverable dynamic import failures", () => {
    expect(isRecoverableWorkloadImportError(new Error("Importing a module script failed."))).toBe(
      true,
    );
    expect(
      isRecoverableWorkloadImportError(new Error("Failed to fetch dynamically imported module")),
    ).toBe(true);
    expect(isRecoverableWorkloadImportError(new Error("plain failure"))).toBe(false);
  });

  it("requires a default export from workload modules", () => {
    const component = {};
    expect(resolveWorkloadComponentExport({ default: component }, "pods")).toBe(component);
    expect(() => resolveWorkloadComponentExport({}, "pods")).toThrow(
      'Workload module "pods" did not expose a default component export.',
    );
  });

  it("allows a one-time reload per path and workload on import failure", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };

    expect(shouldReloadAfterWorkloadImportFailure("pods", "/dashboard/clusters/a", adapter)).toBe(
      true,
    );
    expect(shouldReloadAfterWorkloadImportFailure("pods", "/dashboard/clusters/a", adapter)).toBe(
      false,
    );
    expect(shouldReloadAfterWorkloadImportFailure("pods", "/dashboard/clusters/a", adapter)).toBe(
      true,
    );
  });
});
