/**
 * HashiCorp Vault integration model for dynamic K8s credentials.
 *
 * Supports:
 *   - Vault Kubernetes auth method (pod-based)
 *   - Vault token auth (manual)
 *   - Dynamic kubeconfig retrieval from Vault KV or K8s secrets engine
 *
 * Ref: https://developer.hashicorp.com/vault/docs/secrets/kubernetes
 */

export type VaultAuthMethod = "token" | "kubernetes" | "oidc" | "approle";

export type VaultConfig = {
  address: string;
  authMethod: VaultAuthMethod;
  secretPath: string;
  namespace?: string;
  token?: string;
  role?: string;
  mountPath?: string;
};

export type VaultKubeConfigResponse = {
  kubeconfig?: string;
  token?: string;
  certificate?: string;
  key?: string;
  expiresAt?: string;
  leaseDuration?: number;
};

export function buildVaultLoginPayload(
  config: VaultConfig,
  jwt?: string,
): { url: string; method: string; headers: Record<string, string>; body?: string } {
  const base = config.address.replace(/\/$/, "");
  const ns: Record<string, string> = config.namespace
    ? { "X-Vault-Namespace": config.namespace }
    : {};

  switch (config.authMethod) {
    case "token":
      return {
        url: `${base}/v1/${config.secretPath}`,
        method: "GET",
        headers: { "X-Vault-Token": config.token ?? "", ...ns },
      };

    case "kubernetes":
      return {
        url: `${base}/v1/auth/${config.mountPath ?? "kubernetes"}/login`,
        method: "POST",
        headers: { "Content-Type": "application/json", ...ns },
        body: JSON.stringify({ role: config.role, jwt }),
      };

    case "oidc":
      return {
        url: `${base}/v1/auth/${config.mountPath ?? "oidc"}/login`,
        method: "POST",
        headers: { "Content-Type": "application/json", ...ns },
        body: JSON.stringify({ role: config.role, jwt }),
      };

    case "approle":
      return {
        url: `${base}/v1/auth/${config.mountPath ?? "approle"}/login`,
        method: "POST",
        headers: { "Content-Type": "application/json", ...ns },
        body: JSON.stringify({ role_id: config.role, secret_id: config.token }),
      };
  }
}

export function buildVaultSecretReadPayload(
  config: VaultConfig,
  vaultToken: string,
): { url: string; method: string; headers: Record<string, string> } {
  const base = config.address.replace(/\/$/, "");
  const ns: Record<string, string> = config.namespace
    ? { "X-Vault-Namespace": config.namespace }
    : {};

  return {
    url: `${base}/v1/${config.secretPath}`,
    method: "GET",
    headers: { "X-Vault-Token": vaultToken, ...ns },
  };
}

export function parseVaultSecretResponse(data: Record<string, unknown>): VaultKubeConfigResponse {
  // Vault KV v2 wraps data in data.data
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- runtime guard, Vault response shape varies between KV v1 and v2 */
  const inner =
    ((data.data as Record<string, unknown>)?.data as Record<string, unknown>) ??
    (data.data as Record<string, unknown>) ??
    data;
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  return {
    kubeconfig: typeof inner.kubeconfig === "string" ? inner.kubeconfig : undefined,
    token: typeof inner.token === "string" ? inner.token : undefined,
    certificate: typeof inner.certificate === "string" ? inner.certificate : undefined,
    key: typeof inner.key === "string" ? inner.key : undefined,
    leaseDuration: typeof data.lease_duration === "number" ? data.lease_duration : undefined,
  };
}
