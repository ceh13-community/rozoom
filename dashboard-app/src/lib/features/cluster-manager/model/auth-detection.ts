/**
 * Cluster authentication method detection and token expiry analysis.
 *
 * Based on: https://kubernetes.io/docs/reference/access-authn-authz/authentication/
 *
 * Supported auth methods:
 *   - X.509 client certificates (client-certificate-data)
 *   - Bearer token (token field)
 *   - Exec credential plugin (exec.command - aws, gcloud, az, kubelogin)
 *   - Auth provider (auth-provider - legacy GKE)
 *   - Service account token (projected volume)
 *   - OIDC (via exec plugin or auth-provider)
 */

export type AuthMethod =
  | "x509-certificate"
  | "bearer-token"
  | "exec-plugin"
  | "oidc"
  | "auth-provider"
  | "service-account"
  | "unknown";

export type AuthSecurityLevel = "high" | "medium" | "low" | "unknown";

export type AuthMethodInfo = {
  method: AuthMethod;
  securityLevel: AuthSecurityLevel;
  label: string;
  description: string;
  execPlugin?: string;
  provider?: string;
  tokenExpiry?: string | null;
  tokenExpired?: boolean;
  tokenExpiresInHours?: number | null;
  warnings: string[];
  recommendations: string[];
};

type KubeUserInput = {
  execCommand?: string | null;
  execArgs?: string[] | null;
  authProvider?: string | null;
  hasToken?: boolean;
  hasCertAuth?: boolean;
  token?: string | null;
};

const OIDC_EXEC_COMMANDS = new Set(["kubelogin", "kubectl-oidc_login", "oidc-login"]);

const CLOUD_EXEC_COMMANDS: Record<string, string> = {
  aws: "AWS IAM/SSO",
  "aws-iam-authenticator": "AWS IAM",
  gcloud: "Google Cloud SDK",
  "gke-gcloud-auth-plugin": "GKE Auth Plugin",
  kubelogin: "OIDC Login",
  "kubectl-oidc_login": "OIDC Login",
  az: "Azure CLI",
  doctl: "DigitalOcean CLI",
  oc: "OpenShift CLI",
};

function extractExecName(command: string): string {
  const parts = command.split("/");
  return parts[parts.length - 1] ?? command;
}

function isOidcExec(command: string): boolean {
  const name = extractExecName(command).toLowerCase();
  return OIDC_EXEC_COMMANDS.has(name);
}

function detectTokenExpiry(token: string | null | undefined): {
  expiry: string | null;
  expired: boolean;
  expiresInHours: number | null;
} {
  if (!token) return { expiry: null, expired: false, expiresInHours: null };

  // JWT tokens have 3 base64 parts separated by dots
  const parts = token.split(".");
  if (parts.length !== 3) return { expiry: null, expired: false, expiresInHours: null };

  try {
    const payload = JSON.parse(atob(parts[1])) as { exp?: number };
    if (!payload.exp) return { expiry: null, expired: false, expiresInHours: null };

    const expiryDate = new Date(payload.exp * 1000);
    const now = Date.now();
    const expired = expiryDate.getTime() < now;
    const hoursLeft = (expiryDate.getTime() - now) / (1000 * 60 * 60);

    return {
      expiry: expiryDate.toISOString(),
      expired,
      expiresInHours: Math.round(hoursLeft * 10) / 10,
    };
  } catch {
    return { expiry: null, expired: false, expiresInHours: null };
  }
}

export function detectAuthMethod(user: KubeUserInput): AuthMethodInfo {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Exec plugin (highest priority - most common in cloud environments)
  if (user.execCommand) {
    const execName = extractExecName(user.execCommand);
    const isOidc = isOidcExec(user.execCommand);
    const cloudLabel = CLOUD_EXEC_COMMANDS[execName.toLowerCase()];

    if (isOidc) {
      return {
        method: "oidc",
        securityLevel: "high",
        label: "OIDC (exec plugin)",
        description: `OIDC authentication via ${execName}. Tokens are short-lived and auto-refreshed.`,
        execPlugin: execName,
        tokenExpiry: null,
        tokenExpired: false,
        tokenExpiresInHours: null,
        warnings,
        recommendations,
      };
    }

    return {
      method: "exec-plugin",
      securityLevel: "high",
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard, exec command may not be in CLOUD_EXEC_COMMANDS map
      label: cloudLabel ?? `Exec plugin (${execName})`,
      description: `Credentials provided by ${execName}. Tokens auto-refresh on expiry.`,
      execPlugin: execName,
      tokenExpiry: null,
      tokenExpired: false,
      tokenExpiresInHours: null,
      warnings,
      recommendations,
    };
  }

  // Auth provider (legacy, mostly GKE)
  if (user.authProvider) {
    warnings.push("auth-provider is deprecated in favor of exec-based credential plugins");
    recommendations.push(
      "Migrate to exec plugin: gke-gcloud-auth-plugin for GKE, kubelogin for OIDC",
    );

    return {
      method: "auth-provider",
      securityLevel: "medium",
      label: `Auth provider (${user.authProvider})`,
      description: `Legacy auth provider: ${user.authProvider}. Consider migrating to exec plugin.`,
      provider: user.authProvider,
      tokenExpiry: null,
      tokenExpired: false,
      tokenExpiresInHours: null,
      warnings,
      recommendations,
    };
  }

  // X.509 client certificate
  if (user.hasCertAuth) {
    return {
      method: "x509-certificate",
      securityLevel: "high",
      label: "X.509 client certificate",
      description: "Mutual TLS authentication with client certificate signed by cluster CA.",
      tokenExpiry: null,
      tokenExpired: false,
      tokenExpiresInHours: null,
      warnings,
      recommendations,
    };
  }

  // Bearer token (static)
  if (user.hasToken) {
    const tokenInfo = detectTokenExpiry(user.token);

    if (tokenInfo.expired) {
      warnings.push("Token has expired - authentication will fail");
      recommendations.push("Refresh token or switch to exec-based credential plugin");
    } else if (tokenInfo.expiresInHours !== null && tokenInfo.expiresInHours < 24) {
      warnings.push(`Token expires in ${tokenInfo.expiresInHours} hours`);
      recommendations.push("Consider using exec plugin for automatic token refresh");
    }

    if (!tokenInfo.expiry) {
      warnings.push("Static bearer token without expiry - consider using short-lived tokens");
      recommendations.push("Use exec-based credential plugins for automatic rotation");
    }

    return {
      method: "bearer-token",
      securityLevel: tokenInfo.expiry ? "medium" : "low",
      label: "Bearer token",
      description: tokenInfo.expiry
        ? `JWT bearer token, expires ${tokenInfo.expiry}`
        : "Static bearer token embedded in kubeconfig. No automatic rotation.",
      tokenExpiry: tokenInfo.expiry,
      tokenExpired: tokenInfo.expired,
      tokenExpiresInHours: tokenInfo.expiresInHours,
      warnings,
      recommendations,
    };
  }

  warnings.push("No authentication method detected in kubeconfig");
  recommendations.push("Add credentials: client certificate, bearer token, or exec plugin");

  return {
    method: "unknown",
    securityLevel: "unknown",
    label: "Unknown",
    description: "No authentication credentials found in kubeconfig.",
    tokenExpiry: null,
    tokenExpired: false,
    tokenExpiresInHours: null,
    warnings,
    recommendations,
  };
}

export type ClusterAuthReport = {
  clusters: Array<{
    name: string;
    uuid: string;
    auth: AuthMethodInfo;
  }>;
  summary: {
    total: number;
    highSecurity: number;
    mediumSecurity: number;
    lowSecurity: number;
    expiredTokens: number;
    expiringTokens: number;
    deprecatedAuthProviders: number;
  };
};

export function buildAuthReport(
  clusters: Array<{ name: string; uuid: string; user: KubeUserInput }>,
): ClusterAuthReport {
  const results = clusters.map((c) => ({
    name: c.name,
    uuid: c.uuid,
    auth: detectAuthMethod(c.user),
  }));

  return {
    clusters: results,
    summary: {
      total: results.length,
      highSecurity: results.filter((r) => r.auth.securityLevel === "high").length,
      mediumSecurity: results.filter((r) => r.auth.securityLevel === "medium").length,
      lowSecurity: results.filter((r) => r.auth.securityLevel === "low").length,
      expiredTokens: results.filter((r) => r.auth.tokenExpired).length,
      expiringTokens: results.filter(
        (r) =>
          r.auth.tokenExpiresInHours != null &&
          r.auth.tokenExpiresInHours < 24 &&
          !r.auth.tokenExpired,
      ).length,
      deprecatedAuthProviders: results.filter((r) => r.auth.method === "auth-provider").length,
    },
  };
}
