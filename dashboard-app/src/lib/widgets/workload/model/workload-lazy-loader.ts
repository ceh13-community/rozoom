const WORKLOAD_IMPORT_RELOAD_STORAGE_KEY = "dashboard.workload.import-reload.v1";

export type WorkloadComponentModuleLike = {
  default?: unknown;
};

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error == null) return "";
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function isRecoverableWorkloadImportError(error: unknown) {
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    message.includes("importing a module script failed") ||
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module")
  );
}

export function resolveWorkloadComponentExport(
  module: WorkloadComponentModuleLike | null | undefined,
  workloadType: string,
) {
  if (!module || typeof module !== "object" || !("default" in module) || !module.default) {
    throw new Error(`Workload module "${workloadType}" did not expose a default component export.`);
  }
  return module.default;
}

export function shouldReloadAfterWorkloadImportFailure(
  workloadType: string,
  pathname: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const key = `${pathname}::${workloadType}`;
  const stored = storage.getItem(WORKLOAD_IMPORT_RELOAD_STORAGE_KEY);
  if (stored === key) {
    storage.removeItem(WORKLOAD_IMPORT_RELOAD_STORAGE_KEY);
    return false;
  }
  storage.setItem(WORKLOAD_IMPORT_RELOAD_STORAGE_KEY, key);
  return true;
}
