import { beforeEach, describe, expect, it, vi } from "vitest";
import { readVeleroInstallProfile, writeVeleroInstallProfile } from "./velero-profile";

const readTextFile = vi.fn();
const writeTextFile = vi.fn();
const exists = vi.fn();
const mkdir = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: "appData" },
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
  exists: (...args: unknown[]) => exists(...args),
  mkdir: (...args: unknown[]) => mkdir(...args),
}));

describe("velero profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default profile when file is missing", async () => {
    exists.mockResolvedValue(false);
    const profile = await readVeleroInstallProfile("cluster-a");
    expect(profile.namespace).toBe("velero");
    expect(profile.provider).toBe("aws");
    expect(profile.forcePathStyle).toBe(true);
    expect(profile.awsIamRoleArn).toBe("");
  });

  it("persists sanitized namespace per cluster key", async () => {
    exists.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    mkdir.mockResolvedValue(undefined);
    writeTextFile.mockResolvedValue(undefined);

    const profile = await writeVeleroInstallProfile("cluster-a", { namespace: "Velero_System!!" });

    expect(profile.namespace).toBe("velero-system");
    expect(writeTextFile).toHaveBeenCalledTimes(1);
  });

  it("reads stored profile namespace", async () => {
    exists.mockResolvedValue(true);
    readTextFile.mockResolvedValue(
      JSON.stringify({
        "cluster-a": {
          namespace: "backup-system",
          provider: "do",
          bucket: "team-backups",
          region: "nyc3",
          s3Url: "https://nyc3.digitaloceanspaces.com",
          forcePathStyle: false,
          awsIamRoleArn: "arn:aws:iam::123456789012:role/velero-irsa",
          azureResourceGroup: "rg-backup",
          azureStorageAccount: "velerostore01",
          azureSubscriptionId: "11111111-2222-3333-4444-555555555555",
          azureStorageAccountUri: "https://velerostore01.blob.core.windows.net",
          azureCloudName: "AzurePublicCloud",
          gcpProject: "my-project",
          gcpServiceAccount: "velero@my-project.iam.gserviceaccount.com",
          updatedAt: "2026-02-16T00:00:00.000Z",
        },
      }),
    );

    const profile = await readVeleroInstallProfile("cluster-a");
    expect(profile.namespace).toBe("backup-system");
    expect(profile.provider).toBe("do");
    expect(profile.bucket).toBe("team-backups");
    expect(profile.awsIamRoleArn).toContain(":role/velero-irsa");
    expect(profile.gcpProject).toBe("my-project");
  });
});
