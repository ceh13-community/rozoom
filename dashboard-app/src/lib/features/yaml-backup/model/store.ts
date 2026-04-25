import { writable } from "svelte/store";
import type {
  YamlBackupProgress,
  YamlBackupRequest,
  YamlBackupSnapshot,
  YamlRestoreProgress,
} from "./types";
import {
  createYamlBackup,
  deleteYamlBackup,
  listYamlBackups,
  restoreFromYamlBackup,
} from "./backup-api";

export const yamlBackupProgress = writable<YamlBackupProgress | null>(null);
export const yamlRestoreProgress = writable<YamlRestoreProgress | null>(null);
export const yamlBackupSnapshots = writable<YamlBackupSnapshot[]>([]);

export async function startYamlBackup(request: YamlBackupRequest): Promise<YamlBackupSnapshot> {
  yamlBackupProgress.set({
    phase: "preparing",
    currentResource: "",
    completedResources: 0,
    totalResources: 0,
    errors: [],
  });

  try {
    const snapshot = await createYamlBackup(request, (p) => {
      yamlBackupProgress.set(p);
    });
    await refreshYamlBackupList(request.clusterName);
    return snapshot;
  } catch (err) {
    yamlBackupProgress.set({
      phase: "error",
      currentResource: "",
      completedResources: 0,
      totalResources: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}

export async function refreshYamlBackupList(clusterName?: string): Promise<void> {
  const snapshots = await listYamlBackups(clusterName);
  yamlBackupSnapshots.set(snapshots);
}

export async function removeYamlBackup(snapshot: YamlBackupSnapshot): Promise<void> {
  await deleteYamlBackup(snapshot);
  yamlBackupSnapshots.update((list) => list.filter((s) => s.path !== snapshot.path));
}

export async function startYamlRestore(
  clusterId: string,
  snapshot: YamlBackupSnapshot,
  options: { selectedNamespaces?: string[]; dryRun?: boolean },
): Promise<YamlRestoreProgress> {
  yamlRestoreProgress.set({
    phase: "applying",
    currentFile: "",
    completedFiles: 0,
    totalFiles: 0,
    errors: [],
    applied: [],
  });

  try {
    const result = await restoreFromYamlBackup(clusterId, snapshot, options, (p) => {
      yamlRestoreProgress.set(p);
    });
    return result;
  } catch (err) {
    const errorProgress: YamlRestoreProgress = {
      phase: "error",
      currentFile: "",
      completedFiles: 0,
      totalFiles: 0,
      errors: [err instanceof Error ? err.message : String(err)],
      applied: [],
    };
    yamlRestoreProgress.set(errorProgress);
    throw err;
  }
}
