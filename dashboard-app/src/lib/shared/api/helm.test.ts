import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addHelmRepo,
  getHelmReleaseHistory,
  getHelmReleaseManifest,
  getHelmReleaseStatus,
  getHelmReleaseValues,
  getKubeBenchRelease,
  getKubescapeRelease,
  getPrometheusStackRelease,
  getPlutoRelease,
  getVeleroRelease,
  installOrUpgradeHelmRelease,
  installKubeBench,
  installKubeArmor,
  installKubescape,
  installKubeStateMetrics,
  installMetricsServer,
  installNodeExporter,
  installModelArmor,
  installTrivyOperator,
  listHelmRepos,
  installPrometheusStack,
  removeHelmRepo,
  rollbackHelmRelease,
  testHelmRelease,
  uninstallHelmRelease,
  installVelero,
  uninstallKubeStateMetrics,
} from "./helm";
import * as tauriPath from "@tauri-apps/api/path";
import * as cli from "$shared/api/cli";
import * as tauriApi from "$shared/api/tauri";
import type { Child, Command, IOPayload } from "@tauri-apps/plugin-shell";

vi.mock("@tauri-apps/api/path");
vi.mock("@/lib/shared/api/cli");
vi.mock("@/lib/shared/api/tauri", () => ({
  getClusterNodesNames: vi.fn(),
}));

describe("helm api", () => {
  const mockAppDataDir = "/mock/app/data";
  const clusterId = "cluster id";
  const mockChild = { kill: vi.fn().mockResolvedValue(undefined) } as unknown as Child;
  const mockCommand = {} as Command<IOPayload>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriPath.appDataDir).mockResolvedValue(mockAppDataDir);
    vi.mocked(tauriApi.getClusterNodesNames).mockResolvedValue([]);
  });

  it("installs kube-state-metrics via helm with kubeconfig", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installKubeStateMetrics(clusterId);

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      1,
      "helm",
      [
        "repo",
        "add",
        "prometheus-community",
        "https://prometheus-community.github.io/helm-charts",
        "--force-update",
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      2,
      "helm",
      ["repo", "update", "prometheus-community"],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      [
        "install",
        "kube-state-metrics",
        "prometheus-community/kube-state-metrics",
        "--namespace",
        "kube-state-metrics",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("returns error when repo add fails", async () => {
    vi.mocked(cli.spawnCli).mockImplementationOnce(async (_tool, _args, handlers) => {
      handlers?.onStderrLine?.("boom");
      handlers?.onClose?.({ code: 1 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installKubeStateMetrics(clusterId);

    expect(result).toEqual({ success: false, error: "boom" });
    expect(cli.spawnCli).toHaveBeenCalledTimes(1);
  });

  it("installs metrics-server via helm with kubeconfig", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installMetricsServer(clusterId);

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      1,
      "helm",
      [
        "repo",
        "add",
        "metrics-server",
        "https://kubernetes-sigs.github.io/metrics-server/",
        "--force-update",
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      2,
      "helm",
      ["repo", "update", "metrics-server"],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      [
        "install",
        "metrics-server",
        "metrics-server/metrics-server",
        "--namespace",
        "kube-system",
        "--create-namespace",
        "--set-json",
        'args=["--kubelet-preferred-address-types=InternalDNS,Hostname,InternalIP,ExternalDNS,ExternalIP","--kubelet-use-node-status-port"]',
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("installs metrics-server with local profile for minikube-like clusters", async () => {
    vi.mocked(tauriApi.getClusterNodesNames).mockResolvedValue(["minikube"]);
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installMetricsServer(clusterId);

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      [
        "install",
        "metrics-server",
        "metrics-server/metrics-server",
        "--namespace",
        "kube-system",
        "--create-namespace",
        "--set-json",
        'args=["--kubelet-preferred-address-types=Hostname,InternalDNS,InternalIP,ExternalDNS,ExternalIP","--kubelet-use-node-status-port","--kubelet-insecure-tls"]',
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("installs node-exporter via helm with kubeconfig", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installNodeExporter(clusterId);

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      [
        "repo",
        "add",
        "prometheus-community",
        "https://prometheus-community.github.io/helm-charts",
        "--force-update",
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      4,
      "helm",
      ["repo", "update", "prometheus-community"],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      5,
      "helm",
      [
        "install",
        "prometheus-node-exporter",
        "prometheus-community/prometheus-node-exporter",
        "--namespace",
        "monitoring",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("lists helm repositories", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onStdoutLine?.(
        JSON.stringify([{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }]),
      );
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await listHelmRepos();
    expect(result.error).toBeUndefined();
    expect(result.repos).toEqual([{ name: "bitnami", url: "https://charts.bitnami.com/bitnami" }]);
    expect(cli.spawnCli).toHaveBeenCalledWith(
      "helm",
      ["repo", "list", "--output", "json"],
      expect.any(Object),
    );
  });

  it("adds helm repository and updates index", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await addHelmRepo("bitnami", "https://charts.bitnami.com/bitnami");
    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      1,
      "helm",
      ["repo", "add", "bitnami", "https://charts.bitnami.com/bitnami", "--force-update"],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      2,
      "helm",
      ["repo", "update", "bitnami"],
      expect.any(Object),
    );
  });

  it("installs or upgrades helm release with kubeconfig", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installOrUpgradeHelmRelease(clusterId, {
      releaseName: "nginx",
      chart: "bitnami/nginx",
      namespace: "apps",
      createNamespace: true,
    });

    expect(result).toEqual({ success: true, output: "" });
    expect(cli.spawnCli).toHaveBeenCalledWith(
      "helm",
      [
        "upgrade",
        "--install",
        "nginx",
        "bitnami/nginx",
        "--namespace",
        "apps",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("uninstalls helm release and removes repo", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const uninstallResult = await uninstallHelmRelease(clusterId, {
      releaseName: "nginx",
      namespace: "apps",
    });
    const removeRepoResult = await removeHelmRepo("bitnami");

    expect(uninstallResult).toEqual({ success: true });
    expect(removeRepoResult).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      1,
      "helm",
      [
        "uninstall",
        "nginx",
        "--namespace",
        "apps",
        "--timeout",
        "2m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      2,
      "helm",
      ["repo", "remove", "bitnami"],
      expect.any(Object),
    );
  });

  it("loads helm release status and history", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.(JSON.stringify({ name: "nginx", info: { status: "deployed" } }));
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.(
          JSON.stringify([
            { revision: "1", status: "superseded" },
            { revision: "2", status: "deployed" },
          ]),
        );
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const status = await getHelmReleaseStatus(clusterId, {
      releaseName: "nginx",
      namespace: "apps",
    });
    const history = await getHelmReleaseHistory(clusterId, {
      releaseName: "nginx",
      namespace: "apps",
    });

    expect(status.error).toBeUndefined();
    expect((status.status as { name?: string })?.name).toBe("nginx");
    expect(history.error).toBeUndefined();
    expect(history.history).toHaveLength(2);
  });

  it("loads helm release values and manifest", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("replicaCount: 2");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("apiVersion: apps/v1");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const values = await getHelmReleaseValues(clusterId, {
      releaseName: "nginx",
      namespace: "apps",
      allValues: true,
    });
    const manifest = await getHelmReleaseManifest(clusterId, {
      releaseName: "nginx",
      namespace: "apps",
    });

    expect(values.error).toBeUndefined();
    expect(values.values).toContain("replicaCount");
    expect(manifest.error).toBeUndefined();
    expect(manifest.manifest).toContain("apiVersion");
  });

  it("rolls back and tests helm release", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("test pod logs");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const rollback = await rollbackHelmRelease(clusterId, {
      releaseName: "nginx",
      namespace: "apps",
      revision: "1",
    });
    const testRun = await testHelmRelease(clusterId, { releaseName: "nginx", namespace: "apps" });

    expect(rollback).toEqual({ success: true });
    expect(testRun.success).toBe(true);
    expect(testRun.logs).toContain("test pod logs");
  });

  it("returns error when uninstall fails", async () => {
    vi.mocked(cli.spawnCli).mockImplementationOnce(async (_tool, _args, handlers) => {
      handlers?.onStderrLine?.("not found");
      handlers?.onClose?.({ code: 1 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await uninstallKubeStateMetrics(
      clusterId,
      "kube-state-metrics",
      "kube-state-metrics",
    );

    expect(result).toEqual({ success: false, error: "not found" });
    expect(cli.spawnCli).toHaveBeenCalledWith(
      "helm",
      [
        "uninstall",
        "kube-state-metrics",
        "--namespace",
        "kube-state-metrics",
        "--timeout",
        "2m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("uninstalls with a provided release name", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await uninstallKubeStateMetrics(clusterId, "monitoring", "kps");

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenCalledWith(
      "helm",
      [
        "uninstall",
        "kps",
        "--namespace",
        "monitoring",
        "--timeout",
        "2m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("detects pluto release across namespaces", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onStdoutLine?.(
        JSON.stringify([
          {
            name: "pluto",
            namespace: "security",
            chart: "fairwinds-stable/pluto-2.7.0",
            status: "deployed",
          },
        ]),
      );
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await getPlutoRelease(clusterId);

    expect(result.installed).toBe(true);
    expect(result.release?.namespace).toBe("security");
  });

  it("detects velero release across namespaces", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onStdoutLine?.(
        JSON.stringify([
          {
            name: "velero-main",
            namespace: "backup-system",
            chart: "vmware-tanzu/velero-8.5.0",
            status: "deployed",
          },
        ]),
      );
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await getVeleroRelease(clusterId);

    expect(result.installed).toBe(true);
    expect(result.release?.namespace).toBe("backup-system");
  });

  it("detects kube-prometheus-stack release across namespaces", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onStdoutLine?.(
        JSON.stringify([
          {
            name: "kube-prometheus-stack",
            namespace: "observability",
            chart: "prometheus-community/kube-prometheus-stack-61.7.2",
            status: "deployed",
          },
        ]),
      );
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await getPrometheusStackRelease(clusterId);

    expect(result.installed).toBe(true);
    expect(result.release?.namespace).toBe("observability");
  });

  it("detects kubescape release across namespaces", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onStdoutLine?.(
        JSON.stringify([
          {
            name: "kubescape-operator",
            namespace: "kubescape",
            chart: "kubescape/kubescape-operator-1.26.0",
            status: "deployed",
          },
        ]),
      );
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await getKubescapeRelease(clusterId);

    expect(result.installed).toBe(true);
    expect(result.release?.namespace).toBe("kubescape");
  });

  it("detects kube-bench release across namespaces", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onStdoutLine?.(
        JSON.stringify([
          {
            name: "kube-bench",
            namespace: "security",
            chart: "aquasecurity/kube-bench-0.8.15",
            status: "deployed",
          },
        ]),
      );
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await getKubeBenchRelease(clusterId);

    expect(result.installed).toBe(true);
    expect(result.release?.namespace).toBe("security");
  });

  it("installs velero with vmware tanzu repo", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("[]");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementation(async (_tool, _args, handlers) => {
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const result = await installVelero(clusterId, "velero-system");

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      2,
      "helm",
      [
        "repo",
        "add",
        "vmware-tanzu",
        "https://vmware-tanzu.github.io/helm-charts",
        "--force-update",
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      4,
      "helm",
      [
        "install",
        "velero",
        "vmware-tanzu/velero",
        "--namespace",
        "velero-system",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("installs kube-prometheus-stack with prometheus-community repo", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("[]");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementation(async (_tool, _args, handlers) => {
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const result = await installPrometheusStack(clusterId, "monitoring");

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      4,
      "helm",
      [
        "repo",
        "add",
        "prometheus-community",
        "https://prometheus-community.github.io/helm-charts",
        "--force-update",
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      6,
      "helm",
      [
        "install",
        "kube-prometheus-stack",
        "prometheus-community/kube-prometheus-stack",
        "--namespace",
        "monitoring",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("installs kubescape with kubescape repo", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installKubescape(clusterId, "kubescape");

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      ["repo", "add", "kubescape", "https://kubescape.github.io/helm-charts/", "--force-update"],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      5,
      "helm",
      [
        "install",
        "kubescape-operator",
        "kubescape/kubescape-operator",
        "--namespace",
        "kubescape",
        "--create-namespace",
        "--set",
        "capabilities.continuousScan=enable",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("returns unsupported error for kube-bench helm install", async () => {
    const result = await installKubeBench(clusterId, "kube-bench");

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not currently provide an official Helm chart");
    expect(cli.spawnCli).not.toHaveBeenCalled();
  });

  it("installs kubearmor with kubearmor repo", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installKubeArmor(clusterId, "kubearmor");

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      ["repo", "add", "kubearmor", "https://kubearmor.github.io/charts", "--force-update"],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      5,
      "helm",
      [
        "install",
        "kubearmor-operator",
        "kubearmor/kubearmor-operator",
        "--namespace",
        "kubearmor",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("installs modelarmor with kubearmor repo", async () => {
    const result = await installModelArmor(clusterId, "modelarmor");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not currently published");
    expect(cli.spawnCli).not.toHaveBeenCalled();
  });

  it("installs trivy-operator with aquasecurity repo", async () => {
    vi.mocked(cli.spawnCli).mockImplementation(async (_tool, _args, handlers) => {
      handlers?.onClose?.({ code: 0 });
      return { command: mockCommand, child: mockChild };
    });

    const result = await installTrivyOperator(clusterId, "trivy-system");

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      3,
      "helm",
      [
        "repo",
        "add",
        "aquasecurity",
        "https://aquasecurity.github.io/helm-charts/",
        "--force-update",
      ],
      expect.any(Object),
    );
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      5,
      "helm",
      [
        "install",
        "trivy-operator",
        "aquasecurity/trivy-operator",
        "--namespace",
        "trivy-system",
        "--create-namespace",
        "--wait=watcher",
        "--rollback-on-failure",
        "--timeout",
        "10m",
        "--kubeconfig",
        `${mockAppDataDir}/configs/cluster_id.yaml`,
      ],
      expect.any(Object),
    );
  });

  it("passes IRSA annotation and AWS plugin settings for velero install", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("[]");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementation(async (_tool, _args, handlers) => {
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const result = await installVelero(clusterId, "velero", {
      provider: "aws",
      bucket: "cluster-backups",
      region: "us-east-2",
      awsIamRoleArn: "arn:aws:iam::123456789012:role/velero-irsa",
      forcePathStyle: false,
    });

    expect(result).toEqual({ success: true });
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      6,
      "helm",
      expect.arrayContaining([
        "--set-string",
        "initContainers[0].name=velero-plugin-for-aws",
        "--set-string",
        "configuration.backupStorageLocation[0].provider=aws",
        "--set-string",
        "configuration.backupStorageLocation[0].bucket=cluster-backups",
        "--set-string",
        "configuration.backupStorageLocation[0].config.region=us-east-2",
        "--set",
        "credentials.useSecret=false",
        "--set-string",
        "serviceAccount.server.annotations.eks\\.amazonaws\\.com/role-arn=arn:aws:iam::123456789012:role/velero-irsa",
      ]),
      expect.any(Object),
    );
  });

  it("returns validation error for DO install without endpoint", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("[]");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementation(async (_tool, _args, handlers) => {
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const result = await installVelero(clusterId, "velero", {
      provider: "do",
      bucket: "cluster-backups",
      region: "nyc3",
      awsAccessKeyId: "DO_ACCESS",
      awsSecretAccessKey: "DO_SECRET",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("requires bucket, region, and endpoint URL");
  });

  it("sets gke workload identity annotation when gcp service account is provided", async () => {
    vi.mocked(cli.spawnCli)
      .mockImplementationOnce(async (_tool, _args, handlers) => {
        handlers?.onStdoutLine?.("[]");
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      })
      .mockImplementation(async (_tool, _args, handlers) => {
        handlers?.onClose?.({ code: 0 });
        return { command: mockCommand, child: mockChild };
      });

    const gsa = "velero@my-prod-project.iam.gserviceaccount.com";
    const result = await installVelero(clusterId, "velero", {
      provider: "gcp",
      bucket: "velero-gcs-bucket",
      gcpServiceAccount: gsa,
    });

    expect(result.success).toBe(true);
    expect(cli.spawnCli).toHaveBeenNthCalledWith(
      6,
      "helm",
      expect.arrayContaining([
        "--set-string",
        "configuration.backupStorageLocation[0].provider=gcp",
        "--set",
        "credentials.useSecret=false",
        "--set-string",
        `serviceAccount.server.annotations.iam\\.gke\\.io/gcp-service-account=${gsa}`,
      ]),
      expect.any(Object),
    );
  });
});
