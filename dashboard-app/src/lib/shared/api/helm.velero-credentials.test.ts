import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tauriPath from "@tauri-apps/api/path";
import { remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Child, Command, IOPayload } from "@tauri-apps/plugin-shell";
import * as cli from "@/lib/shared/api/cli";
import { installVelero } from "./helm";
import {
  registerClusterSafetyInfo,
  resetClusterSafetyRegistryForTests,
} from "$shared/lib/readonly-guard";

vi.mock("@tauri-apps/api/path");
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock("@/lib/shared/api/cli");
vi.mock("@/lib/shared/api/tauri", () => ({ getClusterNodesNames: vi.fn(async () => []) }));
vi.mock("$shared/lib/cli-notification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$shared/lib/cli-notification")>()),
  emitCliNotification: vi.fn(),
}));

const clusterId = "cluster-a";
const mockChild = { kill: vi.fn().mockResolvedValue(undefined) } as unknown as Child;
const mockCommand = {} as Command<IOPayload>;

type Handlers = Parameters<typeof cli.spawnCli>[2];

/** helm list says "not installed"; install answers with `installExit`; everything else succeeds. */
function mockHelm(installExit: { code: number; stderr?: string } = { code: 0 }) {
  const timeline: string[] = [];
  vi.mocked(cli.spawnCli).mockImplementation(async (tool, args, handlers?: Handlers) => {
    const sub = args[0];
    if (tool === "helm" && sub === "list") handlers?.onStdoutLine?.("[]");
    if (tool === "helm" && sub === "install") {
      if (installExit.stderr) handlers?.onStderrLine?.(installExit.stderr);
      handlers?.onClose?.({ code: installExit.code });
      timeline.push("install closed");
    } else if (tool === "helm" && sub === "upgrade") {
      // The upgrade ends a moment later, like a real helm run.
      setTimeout(() => {
        timeline.push("upgrade closed");
        handlers?.onClose?.({ code: 0 });
      }, 5);
    } else {
      handlers?.onClose?.({ code: 0 });
    }
    return { command: mockCommand, child: mockChild };
  });
  vi.mocked(remove).mockImplementation(async () => {
    timeline.push("values removed");
  });
  return timeline;
}

function helmCall(sub: string): string[] {
  const call = vi.mocked(cli.spawnCli).mock.calls.find((c) => c[0] === "helm" && c[1][0] === sub);
  if (!call) throw new Error(`no helm ${sub} call`);
  return call[1];
}

function valuesPathOf(args: string[]): string {
  const index = args.indexOf("--values");
  expect(index).toBeGreaterThan(-1);
  return args[index + 1];
}

const CASES = [
  {
    provider: "aws",
    options: {
      provider: "aws" as const,
      bucket: "backups",
      region: "eu-central-1",
      awsAccessKeyId: "AKIA_TEST_ID",
      awsSecretAccessKey: "aws-secret-TEST",
    },
    secrets: ["AKIA_TEST_ID", "aws-secret-TEST"],
    cloud: "[default]\naws_access_key_id=AKIA_TEST_ID\naws_secret_access_key=aws-secret-TEST",
  },
  {
    provider: "hetzner",
    options: {
      provider: "hetzner" as const,
      bucket: "backups",
      region: "fsn1",
      s3Url: "https://fsn1.your-objectstorage.com",
      awsAccessKeyId: "HZ_TEST_ID",
      awsSecretAccessKey: "hz-secret-TEST",
    },
    secrets: ["HZ_TEST_ID", "hz-secret-TEST"],
    cloud: "[default]\naws_access_key_id=HZ_TEST_ID\naws_secret_access_key=hz-secret-TEST",
  },
  {
    provider: "azure",
    options: {
      provider: "azure" as const,
      bucket: "backups",
      azureResourceGroup: "rg",
      azureStorageAccount: "acct",
      azureSubscriptionId: "sub-1",
      azureClientId: "client-1",
      azureClientSecret: "azure-secret-TEST",
      azureTenantId: "tenant-1",
    },
    secrets: ["azure-secret-TEST"],
    cloud: [
      "AZURE_SUBSCRIPTION_ID=sub-1",
      "AZURE_RESOURCE_GROUP=rg",
      "AZURE_CLOUD_NAME=AzurePublicCloud",
      "AZURE_CLIENT_ID=client-1",
      "AZURE_CLIENT_SECRET=azure-secret-TEST",
      "AZURE_TENANT_ID=tenant-1",
    ].join("\n"),
  },
  {
    provider: "gcp",
    options: {
      provider: "gcp" as const,
      bucket: "backups",
      gcpCredentialsJson: '{"type":"service_account","private_key":"gcp-key-TEST"}',
    },
    secrets: ["gcp-key-TEST"],
    cloud: '{"type":"service_account","private_key":"gcp-key-TEST"}',
  },
];

describe("installVelero cloud credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClusterSafetyRegistryForTests();
    registerClusterSafetyInfo([{ uuid: clusterId, name: clusterId, readOnly: false }]);
    vi.mocked(tauriPath.appDataDir).mockResolvedValue("/mock/app/data");
  });

  it.each(CASES)(
    "$provider keys go to helm in an owner-only values file, not on the command line",
    async ({ options, secrets, cloud }) => {
      const timeline = mockHelm();
      const banner: string[] = [];

      const result = await installVelero(clusterId, "velero", options, (chunk) =>
        banner.push(chunk),
      );

      expect(result).toEqual({ success: true });
      const installArgs = helmCall("install");
      const everyArg = installArgs.join(" ");
      for (const secret of secrets) {
        expect(everyArg).not.toContain(secret);
        expect(banner.join("")).not.toContain(secret);
      }
      expect(everyArg).not.toContain("secretContents");

      const path = valuesPathOf(installArgs);
      expect(path).toMatch(/^\/mock\/app\/data\/helm-values-[a-z0-9]+\.yaml$/);
      expect(writeTextFile).toHaveBeenCalledWith(path, expect.any(String), { mode: 0o600 });
      const written = vi.mocked(writeTextFile).mock.calls[0][1] as string;
      expect(JSON.parse(written)).toEqual({ credentials: { secretContents: { cloud } } });

      expect(remove).toHaveBeenCalledWith(path);
      expect(timeline).toEqual(["install closed", "values removed"]);
    },
  );

  it("keeps the values file until the upgrade fallback has finished", async () => {
    const timeline = mockHelm({
      code: 1,
      stderr: "Error: cannot re-use a name that is still in use",
    });

    const result = await installVelero(clusterId, "velero", CASES[0].options);

    expect(result.success).toBe(true);
    const upgradeArgs = helmCall("upgrade");
    expect(upgradeArgs.join(" ")).not.toContain("aws-secret-TEST");
    expect(valuesPathOf(upgradeArgs)).toBe(valuesPathOf(helmCall("install")));
    expect(timeline).toEqual(["install closed", "upgrade closed", "values removed"]);
  });

  it("removes the values file when the install fails", async () => {
    const timeline = mockHelm({ code: 1, stderr: "Error: INSTALLATION FAILED: timed out" });

    const result = await installVelero(clusterId, "velero", CASES[0].options);

    expect(result.success).toBe(false);
    expect(timeline).toEqual(["install closed", "values removed"]);
  });

  it("writes no values file without secret credentials (IRSA)", async () => {
    mockHelm();

    const result = await installVelero(clusterId, "velero", {
      provider: "aws",
      bucket: "backups",
      region: "eu-central-1",
      awsIamRoleArn: "arn:aws:iam::123456789012:role/velero",
    });

    expect(result).toEqual({ success: true });
    expect(helmCall("install")).not.toContain("--values");
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
