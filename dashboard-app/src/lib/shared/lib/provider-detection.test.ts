import { describe, it, expect } from "vitest";
import {
  detectClusterProvider,
  extractRegion,
  getProviderCategory,
  type ProviderDetectionInput,
} from "./provider-detection";

function detect(overrides: Partial<ProviderDetectionInput>) {
  return detectClusterProvider({ clusterName: "", ...overrides });
}

describe("detectClusterProvider", () => {
  describe("server URL detection (highest priority)", () => {
    it("detects AWS EKS from server URL", () => {
      const r = detect({
        clusterName: "my-cluster",
        serverUrl: "https://ABCDEF1234.gr7.us-east-1.eks.amazonaws.com",
      });
      expect(r.provider).toBe("AWS EKS");
      expect(r.category).toBe("managed-cloud");
      expect(r.region).toBe("us-east-1");
    });

    it("detects GKE from server URL", () => {
      const r = detect({
        clusterName: "my-cluster",
        serverUrl: "https://10.0.0.1:443",
        execCommand: "gke-gcloud-auth-plugin",
      });
      expect(r.provider).toBe("GKE");
    });

    it("detects GKE from googleapis URL", () => {
      const r = detect({
        clusterName: "my-cluster",
        serverUrl:
          "https://container.googleapis.com/v1/projects/my-proj/zones/us-central1-a/clusters/prod",
      });
      expect(r.provider).toBe("GKE");
    });

    it("detects AKS from server URL", () => {
      const r = detect({
        clusterName: "aks-prod",
        serverUrl: "https://aks-prod-dns-abc123.hcp.eastus.azmk8s.io:443",
      });
      expect(r.provider).toBe("AKS");
      expect(r.category).toBe("managed-cloud");
    });

    it("detects DigitalOcean from server URL", () => {
      const r = detect({
        clusterName: "do-cluster",
        serverUrl: "https://abc123-sfo1.k8s.ondigitalocean.com",
      });
      expect(r.provider).toBe("DigitalOcean");
      expect(r.region).toBe("sfo1");
    });

    it("detects Hetzner from server URL", () => {
      const r = detect({
        clusterName: "hetzner-prod",
        serverUrl: "https://abc123.fsn1.hcloud.app:6443",
      });
      expect(r.provider).toBe("Hetzner");
      expect(r.region).toBe("fsn1");
    });

    it("detects OKE from server URL", () => {
      const r = detect({
        clusterName: "oke-cluster",
        serverUrl: "https://xyz.us-ashburn-1.clusters.oci.oraclecloud.com:6443",
      });
      expect(r.provider).toBe("OKE");
    });
  });

  describe("local runtime detection from server URL", () => {
    it("detects minikube from localhost + name", () => {
      const r = detect({ clusterName: "minikube", serverUrl: "https://127.0.0.1:8443" });
      expect(r.provider).toBe("Minikube");
      expect(r.category).toBe("local-runtime");
    });

    it("detects kind from localhost + name", () => {
      const r = detect({ clusterName: "kind-dev", serverUrl: "https://127.0.0.1:6443" });
      expect(r.provider).toBe("Kind");
      expect(r.category).toBe("local-runtime");
    });

    it("detects Docker Desktop from host.docker.internal", () => {
      const r = detect({
        clusterName: "docker-desktop",
        serverUrl: "https://host.docker.internal:6443",
      });
      expect(r.provider).toBe("Docker Desktop");
    });

    it("detects k3d from localhost + name", () => {
      const r = detect({ clusterName: "k3d-mycluster", serverUrl: "https://0.0.0.0:6443" });
      expect(r.provider).toBe("K3d");
    });

    it("detects Colima from localhost + name", () => {
      const r = detect({ clusterName: "colima", serverUrl: "https://127.0.0.1:6443" });
      expect(r.provider).toBe("Colima");
    });
  });

  describe("exec command detection (second priority)", () => {
    it("detects AWS EKS from exec command", () => {
      const r = detect({
        clusterName: "prod",
        execCommand: "aws",
        execArgs: ["eks", "get-token", "--cluster-name", "prod"],
      });
      expect(r.provider).toBe("AWS EKS");
      expect(r.authMethod).toBe("exec: aws");
    });

    it("detects AWS EKS from aws-iam-authenticator", () => {
      const r = detect({ clusterName: "prod", execCommand: "aws-iam-authenticator" });
      expect(r.provider).toBe("AWS EKS");
    });

    it("detects GKE from gke-gcloud-auth-plugin", () => {
      const r = detect({ clusterName: "prod", execCommand: "gke-gcloud-auth-plugin" });
      expect(r.provider).toBe("GKE");
    });

    it("detects AKS from kubelogin", () => {
      const r = detect({ clusterName: "prod", execCommand: "kubelogin" });
      expect(r.provider).toBe("AKS");
    });

    it("detects DigitalOcean from doctl", () => {
      const r = detect({ clusterName: "prod", execCommand: "doctl" });
      expect(r.provider).toBe("DigitalOcean");
    });

    it("detects OpenShift from oc", () => {
      const r = detect({ clusterName: "prod", execCommand: "oc" });
      expect(r.provider).toBe("OpenShift");
    });
  });

  describe("name/context fallback detection", () => {
    it("detects AWS EKS from ARN in name", () => {
      const r = detect({ clusterName: "arn:aws:eks:us-east-1:123456:cluster/prod" });
      expect(r.provider).toBe("AWS EKS");
      expect(r.region).toBe("us-east-1");
    });

    it("detects GKE from name", () => {
      const r = detect({ clusterName: "gke_my-project_us-central1-a_prod" });
      expect(r.provider).toBe("GKE");
      expect(r.region).toBe("us-central1-a");
    });

    it("detects AKS from name", () => {
      const r = detect({ clusterName: "aks-prod-eastus" });
      expect(r.provider).toBe("AKS");
      expect(r.region).toBe("eastus");
    });

    it("detects OpenShift from name", () => {
      const r = detect({ clusterName: "openshift-prod" });
      expect(r.provider).toBe("OpenShift");
    });

    it("detects RKE from name", () => {
      const r = detect({ clusterName: "rke-production" });
      expect(r.provider).toBe("RKE");
    });

    it("detects Hetzner from name", () => {
      const r = detect({ clusterName: "hetzner-k8s-fsn1" });
      expect(r.provider).toBe("Hetzner");
      expect(r.region).toBe("fsn1");
    });

    it("detects bare metal from name", () => {
      const r = detect({ clusterName: "bare-metal-dc1" });
      expect(r.provider).toBe("Bare metal");
    });
  });

  describe("bare metal fallback for real IPs", () => {
    it("marks unknown cluster with real server URL as bare metal", () => {
      const r = detect({
        clusterName: "prod-cluster",
        serverUrl: "https://10.20.30.40:6443",
      });
      expect(r.provider).toBe("Bare metal");
      expect(r.category).toBe("self-managed");
    });
  });

  describe("auth method", () => {
    it("returns certificate as default", () => {
      const r = detect({ clusterName: "test" });
      expect(r.authMethod).toBe("certificate");
    });

    it("returns exec with basename", () => {
      const r = detect({ clusterName: "test", execCommand: "/usr/bin/aws" });
      expect(r.authMethod).toBe("exec: aws");
    });

    it("returns auth-provider", () => {
      const r = detect({ clusterName: "test", authProvider: "gcp" });
      expect(r.authMethod).toBe("auth-provider: gcp");
    });
  });

  describe("server URL takes priority over name", () => {
    it("EKS URL wins over GKE name", () => {
      const r = detect({
        clusterName: "gke-cluster",
        serverUrl: "https://abc.us-east-1.eks.amazonaws.com",
      });
      expect(r.provider).toBe("AWS EKS");
    });
  });
});

describe("getProviderCategory", () => {
  it("classifies managed cloud", () => {
    expect(getProviderCategory("AWS EKS")).toBe("managed-cloud");
    expect(getProviderCategory("GKE")).toBe("managed-cloud");
    expect(getProviderCategory("AKS")).toBe("managed-cloud");
    expect(getProviderCategory("DigitalOcean")).toBe("managed-cloud");
    expect(getProviderCategory("Hetzner")).toBe("managed-cloud");
    expect(getProviderCategory("OKE")).toBe("managed-cloud");
  });

  it("classifies local runtimes", () => {
    expect(getProviderCategory("Minikube")).toBe("local-runtime");
    expect(getProviderCategory("Kind")).toBe("local-runtime");
    expect(getProviderCategory("Docker Desktop")).toBe("local-runtime");
  });

  it("classifies self-managed", () => {
    expect(getProviderCategory("OpenShift")).toBe("self-managed");
    expect(getProviderCategory("RKE")).toBe("self-managed");
    expect(getProviderCategory("Bare metal")).toBe("self-managed");
    expect(getProviderCategory("Unknown")).toBe("self-managed");
  });
});

describe("extractRegion", () => {
  it("extracts AWS region from URL", () => {
    expect(extractRegion("AWS EKS", "https://abc.us-west-2.eks.amazonaws.com", "prod")).toBe(
      "us-west-2",
    );
  });

  it("extracts DO region from URL", () => {
    expect(
      extractRegion("DigitalOcean", "https://abc.nyc1.k8s.ondigitalocean.com", "do-prod"),
    ).toBe("nyc1");
  });

  it("extracts Hetzner region from URL", () => {
    expect(extractRegion("Hetzner", "https://abc.nbg1.hcloud.app:6443", "hetz")).toBe("nbg1");
  });

  it("falls back to name pattern", () => {
    expect(extractRegion("AWS EKS", "", "eks-eu-west-1-prod")).toBe("eu-west-1");
  });

  it("returns null when no region found", () => {
    expect(extractRegion("Unknown", "", "generic-cluster")).toBeNull();
  });
});
