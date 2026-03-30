import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkServiceMesh } from "./check-service-mesh";

const mockedKubectl = vi.mocked(kubectlRawFront);

describe("checkServiceMesh", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects Istio when virtualservices CRD is present", async () => {
    mockedKubectl.mockResolvedValue({
      output: ["pods", "services", "virtualservices.networking.istio.io", "deployments.apps"].join(
        "\n",
      ),
      errors: "",
      code: 0,
    });

    const result = await checkServiceMesh(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.detected).toBe(true);
    expect(result.meshType).toBe("istio");
  });

  it("detects Linkerd when serviceprofiles CRD is present", async () => {
    mockedKubectl.mockResolvedValue({
      output: ["pods", "services", "serviceprofiles.linkerd.io", "deployments.apps"].join("\n"),
      errors: "",
      code: 0,
    });

    const result = await checkServiceMesh(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.detected).toBe(true);
    expect(result.meshType).toBe("linkerd");
  });

  it("returns none when no mesh CRDs found", async () => {
    mockedKubectl.mockResolvedValue({
      output: ["pods", "services", "deployments.apps"].join("\n"),
      errors: "",
      code: 0,
    });

    const result = await checkServiceMesh(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.detected).toBe(false);
    expect(result.meshType).toBe("none");
  });

  it("returns unknown on kubectl error", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const result = await checkServiceMesh(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.detected).toBe(false);
    expect(result.meshType).toBe("none");
  });

  it("returns unknown on thrown error", async () => {
    mockedKubectl.mockRejectedValue(new Error("network failure"));

    const result = await checkServiceMesh(clusterId, { force: true });

    expect(result.status).toBe("unknown");
  });
});
