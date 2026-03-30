import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type {
  StorageClassItem,
  StoragePvcItem,
  StorageStatusReport,
  StorageStatusStatus,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: StorageStatusReport; fetchedAt: number }>();

function parseStorageClasses(raw: string): StorageClassItem[] {
  const items: StorageClassItem[] = [];
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const name = parts[0];
    const provisioner = parts[1];
    const isDefault = parts[2] === "true";
    items.push({ name, provisioner, isDefault });
  }

  return items;
}

function parsePvcs(raw: string): StoragePvcItem[] {
  const items: StoragePvcItem[] = [];
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;

    const namespace = parts[0];
    const name = parts[1];
    const status = parts[2];
    const capacity = parts[3] && parts[3] !== "<none>" ? parts[3] : undefined;
    items.push({ namespace, name, status, capacity });
  }

  return items;
}

function computeStatus(pvcs: StoragePvcItem[]): StorageStatusStatus {
  if (pvcs.some((pvc) => pvc.status === "Lost")) return "critical";
  if (pvcs.some((pvc) => pvc.status === "Pending")) return "warning";
  return "ok";
}

export async function checkStorageStatus(
  clusterId: string,
  options?: { force?: boolean },
): Promise<StorageStatusReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let storageClasses: StorageClassItem[] = [];
  let pvcs: StoragePvcItem[] = [];

  try {
    const [scResult, pvcResult] = await Promise.all([
      kubectlRawFront(
        "get storageclasses --no-headers -o custom-columns=NAME:.metadata.name,PROVISIONER:.provisioner,DEFAULT:.metadata.annotations.storageclass\\.kubernetes\\.io/is-default-class",
        { clusterId },
      ),
      kubectlRawFront(
        "get pvc --all-namespaces --no-headers -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,STATUS:.status.phase,CAPACITY:.status.capacity.storage",
        { clusterId },
      ),
    ]);

    if (scResult.errors && !scResult.errors.includes("No resources found")) {
      if (scResult.code !== 0) {
        errorMessage = scResult.errors || "Failed to fetch storage classes.";
        await logError(`Storage status check failed: ${errorMessage}`);
      }
    }
    if (!errorMessage && scResult.output) {
      storageClasses = parseStorageClasses(scResult.output);
    }

    if (pvcResult.errors && !pvcResult.errors.includes("No resources found")) {
      if (pvcResult.code !== 0) {
        errorMessage = pvcResult.errors || "Failed to fetch PVCs.";
        await logError(`Storage status check failed: ${errorMessage}`);
      }
    }
    if (!errorMessage && pvcResult.output) {
      pvcs = parsePvcs(pvcResult.output);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch storage status.";
    await logError(`Storage status check failed: ${errorMessage}`);
  }

  const boundPVCs = pvcs.filter((pvc) => pvc.status === "Bound").length;
  const pendingPVCs = pvcs.filter((pvc) => pvc.status === "Pending").length;
  const lostPVCs = pvcs.filter((pvc) => pvc.status === "Lost").length;
  const status: StorageStatusStatus = errorMessage ? "unknown" : computeStatus(pvcs);

  let message = "Unknown";
  if (status === "critical") {
    message = `${lostPVCs} PVC lost`;
  } else if (status === "warning") {
    message = `${pendingPVCs} PVC pending`;
  } else if (status === "ok") {
    message = `${pvcs.length} PVC bound`;
  }

  const summary = {
    status,
    message,
    storageClasses: storageClasses.length,
    totalPVCs: pvcs.length,
    boundPVCs,
    pendingPVCs,
    lostPVCs,
    updatedAt: Date.now(),
  };

  const items: Array<StorageClassItem | StoragePvcItem> = [...storageClasses, ...pvcs];

  const report: StorageStatusReport = {
    status,
    summary,
    items,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
