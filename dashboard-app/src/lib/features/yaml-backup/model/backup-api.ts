import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { isTauriAvailable } from "$shared/lib/tauri-runtime";
import {
  buildBackupDirPath,
  buildMetadataFilename,
  buildResourceFilename,
  countYamlDocuments,
  parseMetadataFile,
  sanitizeClusterName,
} from "./backup-paths";
import type {
  YamlBackupFileEntry,
  YamlBackupMetadata,
  YamlBackupProgress,
  YamlBackupRequest,
  YamlBackupSnapshot,
  YamlRestoreProgress,
} from "./types";
import {
  CLUSTER_RESOURCES,
  NAMESPACED_RESOURCES,
  RESTORE_ORDER,
  SENSITIVE_NAMESPACED_RESOURCES,
} from "./types";

async function getNamespaces(clusterId: string): Promise<string[]> {
  const result = await kubectlRawFront(
    "get namespaces -o jsonpath={.items[*].metadata.name} --request-timeout=10s",
    { clusterId },
  );
  if (result.errors.length > 0 || !result.output.trim()) return [];
  return result.output.trim().split(/\s+/).filter(Boolean);
}

async function exportResource(
  clusterId: string,
  resourceType: string,
  namespace: string | null,
): Promise<{ yaml: string; error: string | null }> {
  const nsFlag = namespace ? `-n ${namespace}` : "";
  const result = await kubectlRawFront(
    `get ${resourceType} ${nsFlag} -o yaml --request-timeout=30s`,
    { clusterId },
  );
  if (result.code !== 0 || result.errors.length > 0) {
    return { yaml: "", error: result.errors || `Failed to export ${resourceType}` };
  }
  return { yaml: result.output, error: null };
}

export async function createYamlBackup(
  request: YamlBackupRequest,
  onProgress?: (progress: YamlBackupProgress) => void,
): Promise<YamlBackupSnapshot> {
  const timestamp = new Date();
  const dirPath = buildBackupDirPath(request.clusterName, timestamp);

  const progress: YamlBackupProgress = {
    phase: "preparing",
    currentResource: "namespaces",
    completedResources: 0,
    totalResources: 0,
    errors: [],
  };
  onProgress?.(progress);

  const namespaces =
    request.scope === "selected-namespaces" && request.namespaces?.length
      ? request.namespaces
      : await getNamespaces(request.clusterId);

  if (namespaces.length === 0) {
    throw new Error("No namespaces found or accessible in cluster.");
  }

  const namespacedTypes: string[] = [...NAMESPACED_RESOURCES];
  if (request.includeSecrets) {
    namespacedTypes.push(...SENSITIVE_NAMESPACED_RESOURCES);
  }

  const tasks: Array<{ resourceType: string; namespace: string | null }> = [];
  for (const ns of namespaces) {
    for (const rt of namespacedTypes) {
      tasks.push({ resourceType: rt, namespace: ns });
    }
  }
  for (const rt of CLUSTER_RESOURCES) {
    tasks.push({ resourceType: rt, namespace: null });
  }

  progress.totalResources = tasks.length;
  progress.phase = "exporting";
  onProgress?.(progress);

  if (!isTauriAvailable()) {
    throw new Error("Local YAML backup requires the desktop runtime.");
  }

  const { BaseDirectory, writeTextFile, mkdir } = await import("@tauri-apps/plugin-fs");
  await mkdir(dirPath, { baseDir: BaseDirectory.Download, recursive: true });

  const files: YamlBackupFileEntry[] = [];
  const errors: string[] = [];
  const exportedResourceTypes = new Set<string>();

  for (const task of tasks) {
    progress.currentResource = task.namespace
      ? `${task.namespace}/${task.resourceType}`
      : task.resourceType;
    onProgress?.(progress);

    const result = await exportResource(request.clusterId, task.resourceType, task.namespace);

    if (result.error) {
      errors.push(`${progress.currentResource}: ${result.error}`);
    } else if (result.yaml.trim()) {
      const itemCount = countYamlDocuments(result.yaml);
      if (itemCount > 0) {
        const filename = buildResourceFilename(task.resourceType, task.namespace);
        await writeTextFile(`${dirPath}/${filename}`, result.yaml, {
          baseDir: BaseDirectory.Download,
        });
        files.push({
          resourceType: task.resourceType,
          namespace: task.namespace,
          filename,
          itemCount,
        });
        exportedResourceTypes.add(task.resourceType);
      }
    }

    progress.completedResources += 1;
    progress.errors = errors;
    onProgress?.(progress);
  }

  progress.phase = "writing-metadata";
  onProgress?.(progress);

  const metadata: YamlBackupMetadata = {
    version: 1,
    timestamp: timestamp.toISOString(),
    clusterName: request.clusterName,
    clusterId: request.clusterId,
    scope: request.scope,
    namespaces,
    resourceTypes: [...exportedResourceTypes],
    files,
    errors,
  };

  await writeTextFile(`${dirPath}/${buildMetadataFilename()}`, JSON.stringify(metadata, null, 2), {
    baseDir: BaseDirectory.Download,
  });

  progress.phase = "done";
  onProgress?.(progress);

  return {
    path: dirPath,
    timestamp: timestamp.toISOString(),
    clusterName: request.clusterName,
    metadata,
  };
}

export async function listYamlBackups(clusterName?: string): Promise<YamlBackupSnapshot[]> {
  if (!isTauriAvailable()) return [];

  const { BaseDirectory, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
  const snapshots: YamlBackupSnapshot[] = [];

  let clusterDirs: Array<{ name: string; isDirectory: boolean }>;
  try {
    clusterDirs = (await readDir("rozoom/backup", { baseDir: BaseDirectory.Download })).map(
      (entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
      }),
    );
  } catch {
    return [];
  }

  const targetDirs = clusterName
    ? clusterDirs.filter((d) => d.isDirectory && d.name === sanitizeClusterName(clusterName))
    : clusterDirs.filter((d) => d.isDirectory);

  for (const clusterDir of targetDirs) {
    let timestampDirs: Array<{ name: string; isDirectory: boolean }>;
    try {
      timestampDirs = (
        await readDir(`rozoom/backup/${clusterDir.name}`, {
          baseDir: BaseDirectory.Download,
        })
      ).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
      }));
    } catch {
      continue;
    }

    for (const tsDir of timestampDirs) {
      if (!tsDir.isDirectory) continue;
      try {
        const metaPath = `rozoom/backup/${clusterDir.name}/${tsDir.name}/${buildMetadataFilename()}`;
        const metaJson = await readTextFile(metaPath, {
          baseDir: BaseDirectory.Download,
        });
        const metadata = parseMetadataFile(metaJson);
        if (metadata) {
          snapshots.push({
            path: `rozoom/backup/${clusterDir.name}/${tsDir.name}`,
            timestamp: metadata.timestamp,
            clusterName: metadata.clusterName,
            metadata,
          });
        }
      } catch {
        continue;
      }
    }
  }

  snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return snapshots;
}

export async function deleteYamlBackup(snapshot: YamlBackupSnapshot): Promise<void> {
  if (!isTauriAvailable()) return;
  const { BaseDirectory, remove } = await import("@tauri-apps/plugin-fs");
  await remove(snapshot.path, { baseDir: BaseDirectory.Download, recursive: true });
}

export async function restoreFromYamlBackup(
  clusterId: string,
  snapshot: YamlBackupSnapshot,
  options: {
    selectedNamespaces?: string[];
    dryRun?: boolean;
  },
  onProgress?: (progress: YamlRestoreProgress) => void,
): Promise<YamlRestoreProgress> {
  if (!isTauriAvailable()) {
    throw new Error("Restore requires the desktop runtime.");
  }

  const { BaseDirectory, readTextFile, writeTextFile, remove } = await import(
    "@tauri-apps/plugin-fs"
  );
  const { appDataDir } = await import("@tauri-apps/api/path");
  const appDir = await appDataDir();

  let filesToRestore = snapshot.metadata.files;
  if (options.selectedNamespaces?.length) {
    const nsSet = new Set(options.selectedNamespaces);
    filesToRestore = filesToRestore.filter((f) => f.namespace === null || nsSet.has(f.namespace));
  }

  filesToRestore.sort((a, b) => {
    const ia = RESTORE_ORDER.indexOf(a.resourceType);
    const ib = RESTORE_ORDER.indexOf(b.resourceType);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const progress: YamlRestoreProgress = {
    phase: "applying",
    currentFile: "",
    completedFiles: 0,
    totalFiles: filesToRestore.length,
    errors: [],
    applied: [],
  };
  onProgress?.(progress);

  for (const file of filesToRestore) {
    progress.currentFile = file.filename;
    onProgress?.(progress);

    // Per-file unique temp path: two restore runs racing on the same machine
    // (or a user clicking Restore twice) must not overwrite each other's
    // pending YAML before kubectl reads it.
    const tempPath = `${appDir}/yaml-restore-${crypto.randomUUID()}.yaml`;
    let tempWritten = false;

    try {
      const yamlContent = await readTextFile(`${snapshot.path}/${file.filename}`, {
        baseDir: BaseDirectory.Download,
      });

      await writeTextFile(tempPath, yamlContent);
      tempWritten = true;

      // Server-side dry-run validates admission + defaults against live cluster
      // state. Client-side only checks local parse, which does not catch
      // webhook rejections, quota, immutability, or conflicts.
      const dryRunFlag = options.dryRun ? "--dry-run=server" : "";
      const result = await kubectlRawFront(
        `apply -f ${tempPath} ${dryRunFlag} --request-timeout=30s`,
        { clusterId },
      );

      if (result.code !== 0 || result.errors.length > 0) {
        progress.errors.push(`${file.filename}: ${result.errors}`);
      } else {
        progress.applied.push(file.filename);
      }
    } catch (err) {
      progress.errors.push(`${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (tempWritten) {
        await remove(tempPath).catch((e: unknown) => {
          console.warn("failed to remove temp restore file", tempPath, e);
        });
      }
    }

    progress.completedFiles += 1;
    onProgress?.(progress);
  }

  progress.phase = progress.errors.length > 0 ? "error" : "done";
  onProgress?.(progress);
  return progress;
}
