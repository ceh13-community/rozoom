/**
 * Credential hygiene checks for stored kubeconfig files.
 *
 * P1 security measures:
 *   - File permission verification (should be 0600)
 *   - Stale/expired token detection with auto-purge recommendations
 *   - Embedded credential warnings per K8s secrets best practices
 *
 * Based on:
 *   - https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/
 *     "Only use kubeconfig files from trusted sources"
 *   - https://kubernetes.io/docs/concepts/security/secrets-good-practices/
 *     "Avoid logging secret data" / "base64 is NOT encryption"
 */

export type FilePermissionStatus = "secure" | "too-open" | "unknown";

export type CredentialHygieneCheck = {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
  remediation?: string;
};

export type CredentialHygieneReport = {
  clusterId: string;
  clusterName: string;
  checks: CredentialHygieneCheck[];
  passCount: number;
  warnCount: number;
  failCount: number;
};

type HygieneInput = {
  clusterId: string;
  clusterName: string;
  filePermissions?: string | null;
  hasEmbeddedToken: boolean;
  hasEmbeddedClientKey: boolean;
  hasEmbeddedClientCert: boolean;
  insecureSkipTlsVerify: boolean;
  usesExecPlugin: boolean;
  tokenExpired?: boolean;
  tokenExpiresInHours?: number | null;
  configFileExists: boolean;
};

function checkFilePermissions(perms: string | null | undefined): CredentialHygieneCheck {
  if (!perms) {
    return {
      id: "file-permissions",
      title: "File permissions",
      status: "info",
      detail: "Cannot determine file permissions in current runtime.",
    };
  }

  // Unix permissions: expect 0600 or 0400 (owner read/write or read-only)
  const mode = parseInt(perms, 8);
  const groupRead = (mode & 0o040) !== 0;
  const otherRead = (mode & 0o004) !== 0;

  if (groupRead || otherRead) {
    return {
      id: "file-permissions",
      title: "File permissions",
      status: "fail",
      detail: `Kubeconfig file is readable by group/others (${perms}). Should be 0600.`,
      remediation: "Run: chmod 600 <kubeconfig-file>",
    };
  }

  return {
    id: "file-permissions",
    title: "File permissions",
    status: "pass",
    detail: `File permissions are restrictive (${perms}).`,
  };
}

export function runCredentialHygiene(input: HygieneInput): CredentialHygieneReport {
  const checks: CredentialHygieneCheck[] = [];

  // 1. File existence
  if (!input.configFileExists) {
    checks.push({
      id: "config-exists",
      title: "Kubeconfig file",
      status: "fail",
      detail: "Stored kubeconfig file not found on disk.",
      remediation: "Re-import the cluster from the original kubeconfig source.",
    });
  } else {
    checks.push({
      id: "config-exists",
      title: "Kubeconfig file",
      status: "pass",
      detail: "Stored kubeconfig file exists.",
    });
  }

  // 2. File permissions
  checks.push(checkFilePermissions(input.filePermissions));

  // 3. TLS verification
  if (input.insecureSkipTlsVerify) {
    checks.push({
      id: "tls-verify",
      title: "TLS verification",
      status: "fail",
      detail: "insecure-skip-tls-verify is enabled. Connection is vulnerable to MITM attacks.",
      remediation:
        "Disable insecure-skip-tls-verify and configure the correct CA certificate bundle.",
    });
  } else {
    checks.push({
      id: "tls-verify",
      title: "TLS verification",
      status: "pass",
      detail: "TLS certificate verification is enabled.",
    });
  }

  // 4. Credential type
  if (input.usesExecPlugin) {
    checks.push({
      id: "credential-type",
      title: "Credential rotation",
      status: "pass",
      detail: "Uses exec-based credential plugin with automatic token refresh.",
    });
  } else if (input.hasEmbeddedToken) {
    checks.push({
      id: "credential-type",
      title: "Credential rotation",
      status: "warn",
      detail: "Static bearer token embedded in kubeconfig. No automatic rotation.",
      remediation:
        "Switch to exec-based credential plugins (aws, gcloud, kubelogin) for automatic rotation.",
    });
  } else if (input.hasEmbeddedClientKey) {
    checks.push({
      id: "credential-type",
      title: "Credential rotation",
      status: "warn",
      detail: "Client private key embedded in kubeconfig. Rotation requires manual re-import.",
      remediation: "Consider exec plugins or certificate rotation automation.",
    });
  } else {
    checks.push({
      id: "credential-type",
      title: "Credential rotation",
      status: "info",
      detail: "No embedded credentials detected.",
    });
  }

  // 5. Embedded private key
  if (input.hasEmbeddedClientKey) {
    checks.push({
      id: "embedded-key",
      title: "Private key exposure",
      status: "warn",
      detail:
        "Client private key is stored in kubeconfig file on disk. If the file is compromised, the key is exposed.",
      remediation: "Use exec plugins or OS keychain to avoid storing private keys on disk.",
    });
  }

  // 6. Token expiry
  if (input.tokenExpired) {
    checks.push({
      id: "token-expiry",
      title: "Token validity",
      status: "fail",
      detail: "Bearer token has expired. Authentication will fail.",
      remediation: "Refresh the token or re-authenticate via exec plugin / OIDC login.",
    });
  } else if (input.tokenExpiresInHours !== null && input.tokenExpiresInHours !== undefined) {
    if (input.tokenExpiresInHours < 1) {
      checks.push({
        id: "token-expiry",
        title: "Token validity",
        status: "fail",
        detail: `Token expires in less than 1 hour (${input.tokenExpiresInHours}h).`,
        remediation: "Refresh the token immediately.",
      });
    } else if (input.tokenExpiresInHours < 24) {
      checks.push({
        id: "token-expiry",
        title: "Token validity",
        status: "warn",
        detail: `Token expires in ${Math.round(input.tokenExpiresInHours)} hours.`,
        remediation: "Plan token refresh before expiry.",
      });
    } else {
      checks.push({
        id: "token-expiry",
        title: "Token validity",
        status: "pass",
        detail: `Token valid for ${Math.round(input.tokenExpiresInHours)} hours.`,
      });
    }
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  return {
    clusterId: input.clusterId,
    clusterName: input.clusterName,
    checks,
    passCount,
    warnCount,
    failCount,
  };
}
