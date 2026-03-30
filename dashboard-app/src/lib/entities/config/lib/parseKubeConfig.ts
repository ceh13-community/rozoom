import { error } from "@tauri-apps/plugin-log";
import * as yaml from "js-yaml";
import {
  KubeCluster,
  KubeContext,
  KubeUser,
  KubeConfig,
  type KubeConfigFileType,
} from "../model/appConfig";

type RawYamlKubeConfig = {
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

function enrichParsedConfig(raw: RawYamlKubeConfig): KubeConfigFileType {
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
    path: "",
  });
}

export async function parseKubeconfigText(configText: string): Promise<KubeConfig> {
  if (!configText.trim()) {
    await error("Kubeconfig text is empty");
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = yaml.load(configText);
  } catch (err) {
    await error(`Invalid YAML format: ${(err as Error).message}`);
  }

  if (!parsedConfig || typeof parsedConfig !== "object") {
    await error("Invalid kubeconfig structure");
  }

  const enriched = enrichParsedConfig(parsedConfig as RawYamlKubeConfig);
  await validateKubeconfig(enriched);

  return enriched;
}

async function validateKubeconfig(config: KubeConfigFileType): Promise<void> {
  if (!Array.isArray(config.clusters) || config.clusters.length === 0) {
    await error("No clusters found in kubeconfig");
  }

  if (!Array.isArray(config.contexts) || config.contexts.length === 0) {
    await error("No contexts found in kubeconfig");
  }

  if (!Array.isArray(config.users) || config.users.length === 0) {
    await error("No users found in kubeconfig");
  }
}
