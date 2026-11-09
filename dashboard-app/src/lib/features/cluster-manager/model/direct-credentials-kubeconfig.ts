import { kubeconfigTlsYaml } from "./tls-gate";

type DirectCredentialConfig = {
  clusterName: string;
  serverUrl: string;
  caData?: string;
  /** Explicit user choice to skip TLS verification. Never a default for a missing CA. */
  skipTlsVerify?: boolean;
};

function renderKubeconfig(config: DirectCredentialConfig, userName: string, userYaml: string) {
  const { clusterName, serverUrl } = config;
  const tls = kubeconfigTlsYaml({
    server: serverUrl,
    caData: config.caData,
    skipVerification: config.skipTlsVerify,
  });
  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${serverUrl}${tls}
  name: ${clusterName}
contexts:
- context:
    cluster: ${clusterName}
    user: ${userName}
  name: ${clusterName}
current-context: ${clusterName}
users:
- name: ${userName}
  user:
${userYaml}
`;
}

export function generateTokenKubeconfig(
  config: DirectCredentialConfig & { token: string },
): string {
  return renderKubeconfig(config, "token-user", `    token: ${config.token}`);
}

export function generateCertificateKubeconfig(
  config: DirectCredentialConfig & { clientCert: string; clientKey: string },
): string {
  return renderKubeconfig(
    config,
    "cert-user",
    `    client-certificate-data: ${config.clientCert}\n    client-key-data: ${config.clientKey}`,
  );
}
