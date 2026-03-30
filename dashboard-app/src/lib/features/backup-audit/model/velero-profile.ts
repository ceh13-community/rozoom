import type { VeleroCloudProvider } from "$shared/api/helm";
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { CONFIG_DIR } from "$entities/config/model/appConfig";
import { clusterKey } from "$shared/lib/cluster-key";

const PROFILE_FILE = `${CONFIG_DIR}/velero-install-profiles.json`;

export type VeleroInstallProfile = {
  namespace: string;
  provider: VeleroCloudProvider;
  bucket: string;
  region: string;
  s3Url: string;
  forcePathStyle: boolean;
  awsIamRoleArn: string;
  azureResourceGroup: string;
  azureStorageAccount: string;
  azureSubscriptionId: string;
  azureStorageAccountUri: string;
  azureCloudName: string;
  gcpProject: string;
  gcpServiceAccount: string;
  updatedAt: string;
};

type ProfileMap = Record<string, VeleroInstallProfile | undefined>;

function sanitizeNamespace(value: string | undefined | null): string {
  const raw = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw || "velero";
}

async function ensureConfigDir(): Promise<void> {
  const dirExists = await exists(CONFIG_DIR, { baseDir: BaseDirectory.AppData });
  if (!dirExists) {
    await mkdir(CONFIG_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

async function loadProfiles(): Promise<ProfileMap> {
  const hasFile = await exists(PROFILE_FILE, { baseDir: BaseDirectory.AppData });
  if (!hasFile) return {};

  try {
    const raw = await readTextFile(PROFILE_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ProfileMap;
  } catch {
    return {};
  }
}

async function saveProfiles(profiles: ProfileMap): Promise<void> {
  await ensureConfigDir();
  await writeTextFile(PROFILE_FILE, JSON.stringify(profiles, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function readVeleroInstallProfile(clusterId: string): Promise<VeleroInstallProfile> {
  const key = clusterKey(clusterId);
  if (!key) {
    return {
      namespace: "velero",
      provider: "aws",
      bucket: "",
      region: "",
      s3Url: "",
      forcePathStyle: true,
      awsIamRoleArn: "",
      azureResourceGroup: "",
      azureStorageAccount: "",
      azureSubscriptionId: "",
      azureStorageAccountUri: "",
      azureCloudName: "AzurePublicCloud",
      gcpProject: "",
      gcpServiceAccount: "",
      updatedAt: new Date(0).toISOString(),
    };
  }

  const profiles = await loadProfiles();
  const profile = profiles[key];
  return {
    namespace: sanitizeNamespace(profile?.namespace),
    provider: profile?.provider || "aws",
    bucket: profile?.bucket || "",
    region: profile?.region || "",
    s3Url: profile?.s3Url || "",
    forcePathStyle: profile?.forcePathStyle ?? true,
    awsIamRoleArn: profile?.awsIamRoleArn || "",
    azureResourceGroup: profile?.azureResourceGroup || "",
    azureStorageAccount: profile?.azureStorageAccount || "",
    azureSubscriptionId: profile?.azureSubscriptionId || "",
    azureStorageAccountUri: profile?.azureStorageAccountUri || "",
    azureCloudName: profile?.azureCloudName || "AzurePublicCloud",
    gcpProject: profile?.gcpProject || "",
    gcpServiceAccount: profile?.gcpServiceAccount || "",
    updatedAt: profile?.updatedAt || new Date(0).toISOString(),
  };
}

export async function writeVeleroInstallProfile(
  clusterId: string,
  partial: {
    namespace?: string;
    provider?: VeleroCloudProvider;
    bucket?: string;
    region?: string;
    s3Url?: string;
    forcePathStyle?: boolean;
    awsIamRoleArn?: string;
    azureResourceGroup?: string;
    azureStorageAccount?: string;
    azureSubscriptionId?: string;
    azureStorageAccountUri?: string;
    azureCloudName?: string;
    gcpProject?: string;
    gcpServiceAccount?: string;
  },
): Promise<VeleroInstallProfile> {
  const key = clusterKey(clusterId);
  const next: VeleroInstallProfile = {
    namespace: sanitizeNamespace(partial.namespace),
    provider: partial.provider ?? "aws",
    bucket: (partial.bucket ?? "").trim(),
    region: (partial.region ?? "").trim(),
    s3Url: (partial.s3Url ?? "").trim(),
    forcePathStyle: partial.forcePathStyle ?? true,
    awsIamRoleArn: (partial.awsIamRoleArn ?? "").trim(),
    azureResourceGroup: (partial.azureResourceGroup ?? "").trim(),
    azureStorageAccount: (partial.azureStorageAccount ?? "").trim(),
    azureSubscriptionId: (partial.azureSubscriptionId ?? "").trim(),
    azureStorageAccountUri: (partial.azureStorageAccountUri ?? "").trim(),
    azureCloudName: (partial.azureCloudName ?? "AzurePublicCloud").trim() || "AzurePublicCloud",
    gcpProject: (partial.gcpProject ?? "").trim(),
    gcpServiceAccount: (partial.gcpServiceAccount ?? "").trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!key) return next;

  const profiles = await loadProfiles();
  profiles[key] = next;
  await saveProfiles(profiles);
  return next;
}
