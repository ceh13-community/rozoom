/**
 * Credential security model.
 *
 * Analyzes how cluster credentials are stored and recommends improvements
 * for enterprise/banking environments.
 *
 * Based on: https://kubernetes.io/docs/reference/access-authn-authz/authentication/
 *
 * Security tiers:
 *   - Tier 1 (highest): exec plugin with short-lived tokens, no secrets on disk
 *   - Tier 2: OIDC with automatic refresh, encrypted storage
 *   - Tier 3: X.509 certificates with rotation
 *   - Tier 4 (lowest): static bearer token in plaintext kubeconfig
 */

export type CredentialStorageRisk = "none" | "low" | "medium" | "high" | "critical";

export type CredentialRiskFinding = {
  risk: CredentialStorageRisk;
  title: string;
  description: string;
  remediation: string;
};

export type CredentialSecurityReport = {
  clusterName: string;
  findings: CredentialRiskFinding[];
  overallRisk: CredentialStorageRisk;
  score: number;
};

type CredentialInput = {
  clusterName: string;
  hasEmbeddedToken: boolean;
  hasEmbeddedCert: boolean;
  hasEmbeddedKey: boolean;
  usesExecPlugin: boolean;
  usesAuthProvider: boolean;
  insecureSkipTlsVerify: boolean;
  storedPlaintext: boolean;
};

export function analyzeCredentialSecurity(input: CredentialInput): CredentialSecurityReport {
  const findings: CredentialRiskFinding[] = [];
  let score = 100;

  if (input.insecureSkipTlsVerify) {
    findings.push({
      risk: "critical",
      title: "TLS verification disabled",
      description: "insecure-skip-tls-verify is true - vulnerable to man-in-the-middle attacks.",
      remediation:
        "Set insecure-skip-tls-verify to false and configure the correct CA certificate.",
    });
    score -= 30;
  }

  if (input.hasEmbeddedToken && input.storedPlaintext) {
    findings.push({
      risk: "high",
      title: "Bearer token stored in plaintext",
      description:
        "A static bearer token is embedded in the kubeconfig file stored on disk without encryption.",
      remediation:
        "Use exec-based credential plugins (e.g., aws, gcloud, kubelogin) for automatic token rotation. Store sensitive kubeconfigs in OS keychain.",
    });
    score -= 25;
  }

  if (input.hasEmbeddedKey && input.storedPlaintext) {
    findings.push({
      risk: "high",
      title: "Private key stored in plaintext",
      description:
        "Client private key data is embedded in the kubeconfig file stored on disk without encryption.",
      remediation:
        "Use exec-based credential plugins or store private keys in a hardware security module (HSM) or OS keychain.",
    });
    score -= 25;
  }

  if (input.hasEmbeddedCert && !input.hasEmbeddedKey && input.storedPlaintext) {
    findings.push({
      risk: "low",
      title: "Client certificate in plaintext kubeconfig",
      description:
        "Client certificate (public) is embedded in kubeconfig. Less sensitive than private key but reveals identity.",
      remediation: "Consider using exec plugins to provide certificates dynamically.",
    });
    score -= 5;
  }

  if (input.usesAuthProvider) {
    findings.push({
      risk: "medium",
      title: "Deprecated auth-provider mechanism",
      description:
        "auth-provider is deprecated since K8s 1.22 and may be removed in future versions.",
      remediation: "Migrate to exec-based credential plugin. For GKE: use gke-gcloud-auth-plugin.",
    });
    score -= 10;
  }

  if (
    !input.usesExecPlugin &&
    !input.usesAuthProvider &&
    (input.hasEmbeddedToken || input.hasEmbeddedKey)
  ) {
    findings.push({
      risk: "medium",
      title: "No automatic credential rotation",
      description:
        "Credentials are static and do not rotate automatically. If compromised, manual intervention is required.",
      remediation:
        "Switch to exec-based credential plugins that provide short-lived tokens with automatic refresh.",
    });
    score -= 15;
  }

  if (input.usesExecPlugin && findings.length === 0) {
    findings.push({
      risk: "none",
      title: "Dynamic credentials via exec plugin",
      description:
        "Credentials are generated on-demand by an exec plugin. No long-lived secrets stored on disk.",
      remediation: "No action needed. This is the recommended authentication method.",
    });
  }

  score = Math.max(0, score);

  const riskLevels: CredentialStorageRisk[] = findings.map((f) => f.risk);
  let overallRisk: CredentialStorageRisk = "none";
  if (riskLevels.includes("critical")) overallRisk = "critical";
  else if (riskLevels.includes("high")) overallRisk = "high";
  else if (riskLevels.includes("medium")) overallRisk = "medium";
  else if (riskLevels.includes("low")) overallRisk = "low";

  return {
    clusterName: input.clusterName,
    findings,
    overallRisk,
    score,
  };
}
