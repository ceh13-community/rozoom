/**
 * OIDC/SSO connection configuration model.
 *
 * Based on: https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens
 *
 * Generates kubeconfig exec entries for OIDC authentication via kubelogin.
 * Supports Azure AD, Okta, Keycloak, Google Workspace, and generic OIDC providers.
 */

export type OidcProvider = "azure-ad" | "okta" | "keycloak" | "google" | "generic";

export type OidcConfig = {
  provider: OidcProvider;
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  extraArgs?: string[];
};

export type OidcPreset = {
  provider: OidcProvider;
  label: string;
  description: string;
  issuerUrlTemplate: string;
  defaultScopes: string[];
  execCommand: string;
  docsUrl: string;
};

export const OIDC_PRESETS: OidcPreset[] = [
  {
    provider: "azure-ad",
    label: "Azure AD (Entra ID)",
    description: "Microsoft Azure Active Directory / Entra ID for AKS and custom clusters.",
    issuerUrlTemplate: "https://login.microsoftonline.com/{tenant-id}/v2.0",
    defaultScopes: ["openid", "email", "profile", "offline_access"],
    execCommand: "kubelogin",
    docsUrl: "https://azure.github.io/kubelogin/",
  },
  {
    provider: "okta",
    label: "Okta",
    description: "Okta identity provider for enterprise SSO.",
    issuerUrlTemplate: "https://{org}.okta.com",
    defaultScopes: ["openid", "email", "profile", "groups"],
    execCommand: "kubelogin",
    docsUrl: "https://developer.okta.com/docs/guides/",
  },
  {
    provider: "keycloak",
    label: "Keycloak",
    description: "Open-source identity and access management.",
    issuerUrlTemplate: "https://{host}/realms/{realm}",
    defaultScopes: ["openid", "email", "profile"],
    execCommand: "kubelogin",
    docsUrl: "https://www.keycloak.org/docs/latest/",
  },
  {
    provider: "google",
    label: "Google Workspace",
    description: "Google OIDC for GKE and custom clusters.",
    issuerUrlTemplate: "https://accounts.google.com",
    defaultScopes: ["openid", "email"],
    execCommand: "gke-gcloud-auth-plugin",
    docsUrl: "https://cloud.google.com/kubernetes-engine/docs/how-to/oidc",
  },
  {
    provider: "generic",
    label: "Generic OIDC",
    description: "Any OpenID Connect provider.",
    issuerUrlTemplate: "https://{issuer-url}",
    defaultScopes: ["openid", "email", "profile"],
    execCommand: "kubelogin",
    docsUrl:
      "https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens",
  },
];

export function generateKubeloginExecConfig(config: OidcConfig): {
  apiVersion: string;
  command: string;
  args: string[];
} {
  const preset = OIDC_PRESETS.find((p) => p.provider === config.provider);
  const command = preset?.execCommand ?? "kubelogin";
  const scopes = config.scopes ?? preset?.defaultScopes ?? ["openid"];

  const args: string[] = [
    "get-token",
    `--oidc-issuer-url=${config.issuerUrl}`,
    `--oidc-client-id=${config.clientId}`,
  ];

  if (config.clientSecret) {
    args.push(`--oidc-client-secret=${config.clientSecret}`);
  }

  for (const scope of scopes) {
    args.push(`--oidc-extra-scope=${scope}`);
  }

  if (config.extraArgs) {
    args.push(...config.extraArgs);
  }

  return {
    apiVersion: "client.authentication.k8s.io/v1beta1",
    command,
    args,
  };
}

export function generateOidcKubeconfig(
  clusterName: string,
  serverUrl: string,
  caData: string | null,
  config: OidcConfig,
): string {
  const exec = generateKubeloginExecConfig(config);
  const caLine = caData
    ? `    certificate-authority-data: ${caData}`
    : `    insecure-skip-tls-verify: true`;

  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${serverUrl}
${caLine}
  name: ${clusterName}
contexts:
- context:
    cluster: ${clusterName}
    user: oidc-user
  name: ${clusterName}
current-context: ${clusterName}
users:
- name: oidc-user
  user:
    exec:
      apiVersion: ${exec.apiVersion}
      command: ${exec.command}
      args:
${exec.args.map((a) => `      - "${a}"`).join("\n")}`;
}
