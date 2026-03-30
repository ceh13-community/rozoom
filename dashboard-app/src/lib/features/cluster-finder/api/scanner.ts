import {
  KubeCluster,
  KubeContext,
  KubeUser,
  KubeConfig,
  type KubeConfigFileType,
} from "$entities/config";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { path } from "@tauri-apps/api";

type RawKubeConfig = {
  apiVersion?: string;
  kind?: string;
  clusters?: Array<{
    name?: string;
    cluster?: {
      server?: string;
      "certificate-authority-data"?: string;
      "certificate-authority"?: string;
      "insecure-skip-tls-verify"?: boolean;
    };
  }>;
  contexts?: Array<{ name?: string; context?: { cluster?: string; user?: string } }>;
  users?: Array<{
    name?: string;
    user?: {
      exec?: { command?: string; args?: string[] };
      "auth-provider"?: { name?: string };
      token?: string;
      "client-certificate-data"?: string;
    };
  }>;
};

function parseRawKubeConfig(raw: RawKubeConfig, configPath: string): KubeConfigFileType {
  const clusters = (raw.clusters ?? [])
    .filter((e) => e.name)
    .map(
      (e) =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- filtered by .filter(e => e.name) above
        new KubeCluster(e.name!, {
          server: e.cluster?.server,
          certificateAuthority: e.cluster?.["certificate-authority-data"]
            ? "embedded"
            : e.cluster?.["certificate-authority"],
          insecureSkipTlsVerify: e.cluster?.["insecure-skip-tls-verify"],
        }),
    );

  const contexts = (raw.contexts ?? [])
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for external YAML data
    .filter((e) => e.name && e.context?.cluster && e.context?.user)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- values verified by .filter() above
    .map((e) => new KubeContext(e.name!, { cluster: e.context!.cluster!, user: e.context!.user! }));

  const users = (raw.users ?? [])
    .filter((e) => e.name)
    .map(
      (e) =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- filtered by .filter(e => e.name) above
        new KubeUser(e.name!, {
          execCommand: e.user?.exec?.command,
          execArgs: e.user?.exec?.args,
          authProvider: e.user?.["auth-provider"]?.name,
          hasToken: !!e.user?.token,
          hasCertAuth: !!e.user?.["client-certificate-data"],
        }),
    );

  return new KubeConfig({
    apiVersion: raw.apiVersion ?? "v1",
    kind: raw.kind ?? "Config",
    clusters,
    contexts,
    users,
    path: configPath,
  });
}

async function getKubeConfigData() {
  const { output } = await kubectlRawFront("config view -o json");

  if (!output.length || output.trim() === "") return null;

  const raw = JSON.parse(output) as RawKubeConfig;
  const configPath = await path.join(await path.homeDir(), `.kube/config`);

  return parseRawKubeConfig(raw, configPath);
}

export async function scanKubeconfigs(): Promise<KubeConfigFileType | null> {
  const config: KubeConfigFileType | null = await getKubeConfigData();

  if (!config) {
    return null;
  }

  return config;
}
