import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenKubeconfig = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://api.example.com
  name: c
contexts:
- context:
    cluster: c
    user: u
  name: c
current-context: c
users:
- name: u
  user:
    token: xoxb-abc
`;

const execKubeconfig = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://api.example.com
    certificate-authority-data: LS0=
  name: c
contexts:
- context:
    cluster: c
    user: u
  name: c
current-context: c
users:
- name: u
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
      - eks
      - get-token
`;

vi.mock("../api/disk", () => ({
  getClusterFromDisk: vi.fn(),
}));

import { getClusterFromDisk } from "../api/disk";
import {
  loadClusterAuthInfo,
  getCachedAuthInfo,
  clearClusterAuthCache,
} from "./cluster-auth-cache";

const getClusterFromDiskMock = getClusterFromDisk as unknown as ReturnType<typeof vi.fn>;

describe("cluster-auth-cache", () => {
  beforeEach(() => {
    clearClusterAuthCache();
    getClusterFromDiskMock.mockReset();
  });

  it("detects token-based auth", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(tokenKubeconfig);
    const info = await loadClusterAuthInfo("uuid-1");
    expect(info).not.toBeNull();
    expect(info?.method).toBe("bearer-token");
    expect(info?.securityLevel).toBe("low");
  });

  it("detects exec-plugin auth", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(execKubeconfig);
    const info = await loadClusterAuthInfo("uuid-2");
    expect(info?.method).toBe("exec-plugin");
    expect(info?.securityLevel).toBe("high");
  });

  it("caches repeated reads", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(tokenKubeconfig);
    await loadClusterAuthInfo("u3");
    await loadClusterAuthInfo("u3");
    await loadClusterAuthInfo("u3");
    expect(getClusterFromDiskMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent callers", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(execKubeconfig);
    const [a, b] = await Promise.all([loadClusterAuthInfo("u4"), loadClusterAuthInfo("u4")]);
    expect(a).toBe(b);
    expect(getClusterFromDiskMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when kubeconfig is missing", async () => {
    getClusterFromDiskMock.mockResolvedValueOnce(null);
    expect(await loadClusterAuthInfo("u5")).toBeNull();
  });

  it("getCachedAuthInfo returns undefined before load", () => {
    expect(getCachedAuthInfo("never")).toBeUndefined();
  });
});
