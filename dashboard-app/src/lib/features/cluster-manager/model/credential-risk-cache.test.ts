import { beforeEach, describe, expect, it, vi } from "vitest";

const kubeconfigToken = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://api.example.com
    insecure-skip-tls-verify: true
  name: risky
contexts:
- context:
    cluster: risky
    user: risky-user
  name: risky
current-context: risky
users:
- name: risky-user
  user:
    token: xoxb-abc`;

const kubeconfigExec = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://api.example.com
    certificate-authority-data: LS0tLS1CRUdJTg==
  name: safe
contexts:
- context:
    cluster: safe
    user: safe-user
  name: safe
current-context: safe
users:
- name: safe-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
      - eks
      - get-token`;

vi.mock("../api/disk", () => ({
  getClusterFromDisk: vi.fn(),
}));

import { getClusterFromDisk } from "../api/disk";
import {
  loadCredentialReport,
  getCachedCredentialReport,
  clearCredentialReportCache,
} from "./credential-risk-cache";

const getClusterFromDiskMock = getClusterFromDisk as unknown as ReturnType<typeof vi.fn>;

describe("credential-risk-cache", () => {
  beforeEach(() => {
    clearCredentialReportCache();
    getClusterFromDiskMock.mockReset();
  });

  it("surfaces critical finding for plaintext token + insecure TLS", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(kubeconfigToken);
    const report = await loadCredentialReport("uuid-1", "risky");
    expect(report).not.toBeNull();
    expect(report?.overallRisk).toBe("critical");
    expect(report?.findings.some((f) => f.title.includes("TLS"))).toBe(true);
    expect(report?.findings.some((f) => f.title.toLowerCase().includes("token"))).toBe(true);
  });

  it("marks exec-plugin configs as none-risk", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(kubeconfigExec);
    const report = await loadCredentialReport("uuid-2", "safe");
    expect(report?.overallRisk).toBe("none");
  });

  it("caches reports so disk is read only once", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(kubeconfigExec);
    await loadCredentialReport("uuid-3", "safe");
    await loadCredentialReport("uuid-3", "safe");
    await loadCredentialReport("uuid-3", "safe");
    expect(getClusterFromDiskMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent callers into a single read", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(kubeconfigExec);
    const [a, b] = await Promise.all([
      loadCredentialReport("uuid-4", "safe"),
      loadCredentialReport("uuid-4", "safe"),
    ]);
    expect(a).toBe(b);
    expect(getClusterFromDiskMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when kubeconfig is missing", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(null);
    const report = await loadCredentialReport("uuid-5", "gone");
    expect(report).toBeNull();
  });

  it("getCachedCredentialReport returns undefined before load", () => {
    expect(getCachedCredentialReport("never-loaded")).toBeUndefined();
  });
});
