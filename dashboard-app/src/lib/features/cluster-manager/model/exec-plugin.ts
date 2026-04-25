/**
 * Exec-based credential plugin configuration.
 *
 * Based on: https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins
 *
 * Exec plugins are the recommended way to connect kubectl-compatible clients
 * to a cluster without persisting long-lived credentials on disk. kubectl
 * invokes the plugin before each API call; the plugin returns an
 * ExecCredential object with a short-lived token.
 *
 * Supported presets:
 *   - aws-eks    : `aws eks get-token`           (bundled aws CLI, no extra install)
 *   - aws-iam    : `aws-iam-authenticator token` (external binary, user-installed)
 *   - gke-auth   : `gke-gcloud-auth-plugin`      (ships with gcloud SDK)
 *   - kubelogin  : `kubelogin get-token`         (external binary, user-installed)
 *   - oc-login   : `oc login`                    (OpenShift)
 *   - generic    : arbitrary command + args
 */

export type ExecPluginKind =
  | "aws-eks"
  | "aws-iam"
  | "gke-auth"
  | "kubelogin"
  | "oc-login"
  | "generic";

export type ExecPluginConfig = {
  kind: ExecPluginKind;
  clusterName: string;
  serverUrl: string;
  caData?: string;
  /** aws-eks: cluster name. kubelogin: OIDC issuer URL. Meaning depends on kind. */
  primary?: string;
  /** aws-eks: region. kubelogin: client ID. gke-auth: ignored. */
  secondary?: string;
  /** kubelogin only: OIDC client secret (avoid if possible - prefer PKCE). */
  tertiary?: string;
  /** aws-eks: AWS profile. Generic: extra args (space-separated). */
  extra?: string;
  /** generic: command path/name. */
  command?: string;
  /** generic: full arg list override (wins over kind defaults). */
  args?: string[];
};

export type ExecPluginPreset = {
  kind: ExecPluginKind;
  label: string;
  description: string;
  /** Field labels (undefined = hide that input). */
  primaryLabel?: string;
  primaryPlaceholder?: string;
  secondaryLabel?: string;
  secondaryPlaceholder?: string;
  tertiaryLabel?: string;
  tertiaryPlaceholder?: string;
  extraLabel?: string;
  extraPlaceholder?: string;
  docsUrl: string;
  /** Whether the plugin binary is bundled with the app. */
  bundled: boolean;
  /** Security rating for UI badge. */
  security: "high" | "medium";
  securityDetail: string;
};

export const EXEC_PLUGIN_PRESETS: ExecPluginPreset[] = [
  {
    kind: "aws-eks",
    label: "AWS EKS (aws eks get-token)",
    description:
      "Uses the bundled AWS CLI to obtain a short-lived EKS token before every API call.",
    primaryLabel: "EKS cluster name *",
    primaryPlaceholder: "prod-cluster",
    secondaryLabel: "AWS region *",
    secondaryPlaceholder: "us-east-1",
    extraLabel: "AWS profile (optional)",
    extraPlaceholder: "default",
    docsUrl: "https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html#get-token",
    bundled: true,
    security: "high",
    securityDetail:
      "Tokens live ~15 minutes and are generated on demand by the bundled aws CLI. No secrets on disk.",
  },
  {
    kind: "gke-auth",
    label: "GKE (gke-gcloud-auth-plugin)",
    description:
      "Uses the bundled gcloud SDK plugin to exchange your gcloud identity for short-lived GKE tokens.",
    docsUrl: "https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl",
    bundled: true,
    security: "high",
    securityDetail:
      "Tokens are generated per-call by the bundled gcloud SDK. Requires `gcloud auth login` once.",
  },
  {
    kind: "kubelogin",
    label: "OIDC (kubelogin)",
    description:
      "Browser-based OIDC flow with PKCE. Works with Azure AD, Okta, Keycloak, Google, any OIDC issuer.",
    primaryLabel: "Issuer URL *",
    primaryPlaceholder: "https://login.microsoftonline.com/{tenant}/v2.0",
    secondaryLabel: "Client ID *",
    secondaryPlaceholder: "00000000-0000-0000-0000-000000000000",
    tertiaryLabel: "Client secret (optional, prefer PKCE)",
    tertiaryPlaceholder: "",
    docsUrl: "https://github.com/int128/kubelogin",
    bundled: false,
    security: "high",
    securityDetail:
      "Tokens cached in ~/.kube/cache/oidc-login/ with 5-10 min TTL. PKCE avoids storing client secret. Requires kubelogin installed in PATH.",
  },
  {
    kind: "aws-iam",
    label: "AWS IAM Authenticator",
    description:
      "Legacy AWS exec plugin. Prefer aws-eks above unless a specific policy requires it.",
    primaryLabel: "EKS cluster name *",
    primaryPlaceholder: "prod-cluster",
    extraLabel: "AWS profile (optional)",
    extraPlaceholder: "default",
    docsUrl: "https://github.com/kubernetes-sigs/aws-iam-authenticator",
    bundled: false,
    security: "high",
    securityDetail:
      "Same security model as aws-eks but needs aws-iam-authenticator binary in PATH.",
  },
  {
    kind: "oc-login",
    label: "OpenShift (oc)",
    description:
      "Uses the bundled `oc` CLI to obtain short-lived OpenShift tokens via its login flow.",
    docsUrl:
      "https://docs.openshift.com/container-platform/latest/cli_reference/openshift_cli/getting-started-cli.html",
    bundled: true,
    security: "high",
    securityDetail:
      "Token lifetime follows the OpenShift OAuth token TTL (default 24h). Rotated automatically on re-login.",
  },
  {
    kind: "generic",
    label: "Generic exec plugin",
    description:
      "Escape hatch: provide any command + args that implements the client-go credential plugin protocol.",
    primaryLabel: "Command *",
    primaryPlaceholder: "my-auth-helper",
    extraLabel: "Args (space-separated)",
    extraPlaceholder: "--flag value",
    docsUrl:
      "https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins",
    bundled: false,
    security: "medium",
    securityDetail:
      "Security depends entirely on the plugin you provide. Prefer a bundled preset when one fits.",
  },
];

export function getExecPluginPreset(kind: ExecPluginKind): ExecPluginPreset {
  const preset = EXEC_PLUGIN_PRESETS.find((p) => p.kind === kind);
  if (!preset) throw new Error(`Unknown exec plugin kind: ${kind}`);
  return preset;
}

/**
 * Build the exec block (command + args) for the generated kubeconfig.
 * The apiVersion is always client.authentication.k8s.io/v1beta1.
 */
export function buildExecBlock(config: ExecPluginConfig): {
  apiVersion: string;
  command: string;
  args: string[];
} {
  const apiVersion = "client.authentication.k8s.io/v1beta1";

  switch (config.kind) {
    case "aws-eks": {
      if (!config.primary?.trim() || !config.secondary?.trim()) {
        throw new Error("aws-eks requires cluster name and region");
      }
      const args = [
        "--region",
        config.secondary.trim(),
        "eks",
        "get-token",
        "--cluster-name",
        config.primary.trim(),
        "--output",
        "json",
      ];
      if (config.extra?.trim()) {
        args.push("--profile", config.extra.trim());
      }
      return { apiVersion, command: "aws", args };
    }
    case "aws-iam": {
      if (!config.primary?.trim()) {
        throw new Error("aws-iam requires cluster name");
      }
      const args = ["token", "-i", config.primary.trim()];
      if (config.extra?.trim()) {
        args.push("--profile", config.extra.trim());
      }
      return { apiVersion, command: "aws-iam-authenticator", args };
    }
    case "gke-auth": {
      return { apiVersion, command: "gke-gcloud-auth-plugin", args: [] };
    }
    case "kubelogin": {
      if (!config.primary?.trim() || !config.secondary?.trim()) {
        throw new Error("kubelogin requires issuer URL and client ID");
      }
      const args = [
        "get-token",
        `--oidc-issuer-url=${config.primary.trim()}`,
        `--oidc-client-id=${config.secondary.trim()}`,
      ];
      if (config.tertiary?.trim()) {
        args.push(`--oidc-client-secret=${config.tertiary.trim()}`);
      }
      return { apiVersion, command: "kubelogin", args };
    }
    case "oc-login": {
      return { apiVersion, command: "oc", args: ["get-token"] };
    }
    case "generic": {
      const cmd = config.primary?.trim() || config.command?.trim();
      if (!cmd) {
        throw new Error("generic requires a command");
      }
      const args = config.args ?? (config.extra?.trim() ? config.extra.trim().split(/\s+/) : []);
      return { apiVersion, command: cmd, args };
    }
  }
}

/**
 * Generate a complete kubeconfig YAML with an exec user block.
 *
 * No long-lived credentials are embedded: the exec plugin is invoked by
 * kubectl/this app on every API call to obtain a short-lived token.
 */
export function generateExecKubeconfig(config: ExecPluginConfig): string {
  if (!config.clusterName.trim()) throw new Error("clusterName is required");
  if (!config.serverUrl.trim()) throw new Error("serverUrl is required");

  const exec = buildExecBlock(config);
  const caLine = config.caData?.trim()
    ? `    certificate-authority-data: ${config.caData.trim()}`
    : `    insecure-skip-tls-verify: true`;

  const argsYaml = exec.args.length
    ? "\n" + exec.args.map((a) => `      - ${JSON.stringify(a)}`).join("\n")
    : " []";

  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${config.serverUrl.trim()}
${caLine}
  name: ${config.clusterName.trim()}
contexts:
- context:
    cluster: ${config.clusterName.trim()}
    user: exec-user
  name: ${config.clusterName.trim()}
current-context: ${config.clusterName.trim()}
users:
- name: exec-user
  user:
    exec:
      apiVersion: ${exec.apiVersion}
      command: ${exec.command}
      args:${argsYaml}
      interactiveMode: IfAvailable
`;
}
