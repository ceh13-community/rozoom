import { describe, expect, it, vi, beforeEach } from "vitest";
import { KubeCluster, KubeConfig, KubeContext, KubeUser } from "$entities/config";
import { selectLocalContexts, discoverLocalClusters } from "./local-discovery";

const scanKubeconfigs = vi.hoisted(() => vi.fn());
vi.mock("../api/scanner", () => ({ scanKubeconfigs }));

function makeConfig(opts: {
  clusters: KubeCluster[];
  contexts: KubeContext[];
  users?: KubeUser[];
}) {
  return new KubeConfig({
    apiVersion: "v1",
    kind: "Config",
    clusters: opts.clusters,
    contexts: opts.contexts,
    users: opts.users ?? [],
    path: "/home/u/.kube/config",
  });
}

describe("selectLocalContexts", () => {
  it("selects a minikube context by local server + name", () => {
    const config = makeConfig({
      clusters: [new KubeCluster("minikube", { server: "https://127.0.0.1:8443" })],
      contexts: [new KubeContext("minikube", { cluster: "minikube", user: "minikube" })],
      users: [new KubeUser("minikube", { hasCertAuth: true })],
    });

    const result = selectLocalContexts(config);

    expect(result).toEqual([
      {
        contextName: "minikube",
        clusterName: "minikube",
        server: "https://127.0.0.1:8443",
        provider: "Minikube",
      },
    ]);
  });

  it("excludes a remote managed cluster (GKE)", () => {
    const config = makeConfig({
      clusters: [
        new KubeCluster("gke_proj_zone_prod", {
          server: "https://34.10.20.30.googleapis.com",
        }),
      ],
      contexts: [
        new KubeContext("gke_proj_zone_prod", {
          cluster: "gke_proj_zone_prod",
          user: "gke_proj_zone_prod",
        }),
      ],
      users: [new KubeUser("gke_proj_zone_prod", { execCommand: "gke-gcloud-auth-plugin" })],
    });

    expect(selectLocalContexts(config)).toEqual([]);
  });

  it("keeps only the local contexts when local and remote are mixed", () => {
    const config = makeConfig({
      clusters: [
        new KubeCluster("kind-dev", { server: "https://127.0.0.1:6443" }),
        new KubeCluster("eks-prod", { server: "https://abc.eks.amazonaws.com" }),
        new KubeCluster("docker-desktop", { server: "https://kubernetes.docker.internal:6443" }),
      ],
      contexts: [
        new KubeContext("kind-dev", { cluster: "kind-dev", user: "kind-dev" }),
        new KubeContext("eks-prod", { cluster: "eks-prod", user: "eks-prod" }),
        new KubeContext("docker-desktop", { cluster: "docker-desktop", user: "docker-desktop" }),
      ],
    });

    const names = selectLocalContexts(config).map((c) => c.contextName);
    expect(names).toEqual(["kind-dev", "docker-desktop"]);
  });

  it("preserves kubeconfig order so the UI can pick a primary", () => {
    const config = makeConfig({
      clusters: [
        new KubeCluster("k3d-a", { server: "https://0.0.0.0:6550" }),
        new KubeCluster("minikube", { server: "https://127.0.0.1:8443" }),
      ],
      contexts: [
        new KubeContext("k3d-a", { cluster: "k3d-a", user: "k3d-a" }),
        new KubeContext("minikube", { cluster: "minikube", user: "minikube" }),
      ],
    });

    expect(selectLocalContexts(config).map((c) => c.contextName)).toEqual(["k3d-a", "minikube"]);
  });

  it("tolerates a context whose cluster/user entries are missing", () => {
    // dangling context: classifier still runs on the name alone, no throw
    const config = makeConfig({
      clusters: [],
      contexts: [new KubeContext("minikube", { cluster: "minikube", user: "minikube" })],
    });

    const result = selectLocalContexts(config);
    expect(result).toEqual([
      { contextName: "minikube", clusterName: "minikube", server: null, provider: "Minikube" },
    ]);
  });

  it("returns empty for an empty kubeconfig", () => {
    expect(selectLocalContexts(makeConfig({ clusters: [], contexts: [] }))).toEqual([]);
  });
});

describe("discoverLocalClusters", () => {
  beforeEach(() => {
    scanKubeconfigs.mockReset();
  });

  it("returns [] when no kubeconfig is found", async () => {
    scanKubeconfigs.mockResolvedValue(null);
    expect(await discoverLocalClusters()).toEqual([]);
  });

  it("scans the kubeconfig and surfaces only local-runtime contexts", async () => {
    scanKubeconfigs.mockResolvedValue(
      makeConfig({
        clusters: [
          new KubeCluster("minikube", { server: "https://127.0.0.1:8443" }),
          new KubeCluster("eks-prod", { server: "https://abc.eks.amazonaws.com" }),
        ],
        contexts: [
          new KubeContext("minikube", { cluster: "minikube", user: "minikube" }),
          new KubeContext("eks-prod", { cluster: "eks-prod", user: "eks-prod" }),
        ],
      }),
    );

    const result = await discoverLocalClusters();

    expect(result.map((c) => c.contextName)).toEqual(["minikube"]);
  });
});
