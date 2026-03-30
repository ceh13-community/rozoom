import {
  getAllResourceSchemas,
  hasResourceCapability,
  type ResourceDomain,
} from "$entities/workload";
import { KUBECTL_COMMANDS } from "$shared/config/kubectl-commands";
import type { WorkloadType } from "$shared/model/workloads";

export type TriageScorerId =
  | "namespaces"
  | "nodes"
  | "pods"
  | "controller"
  | "jobs"
  | "cronjobs"
  | "configmaps"
  | "secrets"
  | "resourcequotas"
  | "limitranges"
  | "persistentvolumeclaims"
  | "persistentvolumes"
  | "priorityclasses"
  | "runtimeclasses"
  | "leases"
  | "webhookconfigurations"
  | "serviceaccounts"
  | "roles"
  | "bindings"
  | "customresourcedefinitions"
  | "services"
  | "endpoints"
  | "endpointslices"
  | "ingresses"
  | "ingressclasses"
  | "gatewayclasses"
  | "gateways"
  | "httproutes"
  | "referencegrants"
  | "networkpolicies"
  | "horizontalpodautoscalers"
  | "poddisruptionbudgets"
  | "storageclasses"
  | "volumeattributesclasses"
  | "volumesnapshots"
  | "volumesnapshotcontents"
  | "volumesnapshotclasses"
  | "csistoragecapacities";

export type TriageMode = "problem_scored";
export type TriageFetchKind = "kubectl_list";
export type TriageOptionalFeature =
  | "none"
  | "gateway_api"
  | "volume_snapshots"
  | "volume_attributes_class";

export type TriageManifestEntry = {
  key: WorkloadType;
  title: string;
  domain: ResourceDomain;
  resourceName: string;
  command: string;
  scorerId: TriageScorerId;
  triageMode: TriageMode;
  fetchKind: TriageFetchKind;
  optionalFeature: TriageOptionalFeature;
  namespaced: boolean;
};

const TRIAGE_SCORERS: Partial<Record<WorkloadType, TriageScorerId>> = {
  namespaces: "namespaces",
  nodesstatus: "nodes",
  pods: "pods",
  deployments: "controller",
  daemonsets: "controller",
  statefulsets: "controller",
  replicasets: "controller",
  replicationcontrollers: "controller",
  jobs: "jobs",
  cronjobs: "cronjobs",
  configmaps: "configmaps",
  secrets: "secrets",
  resourcequotas: "resourcequotas",
  limitranges: "limitranges",
  priorityclasses: "priorityclasses",
  runtimeclasses: "runtimeclasses",
  leases: "leases",
  mutatingwebhookconfigurations: "webhookconfigurations",
  validatingwebhookconfigurations: "webhookconfigurations",
  serviceaccounts: "serviceaccounts",
  roles: "roles",
  clusterroles: "roles",
  rolebindings: "bindings",
  clusterrolebindings: "bindings",
  customresourcedefinitions: "customresourcedefinitions",
  persistentvolumeclaims: "persistentvolumeclaims",
  persistentvolumes: "persistentvolumes",
  services: "services",
  endpoints: "endpoints",
  endpointslices: "endpointslices",
  ingresses: "ingresses",
  ingressclasses: "ingressclasses",
  gatewayclasses: "gatewayclasses",
  gateways: "gateways",
  httproutes: "httproutes",
  referencegrants: "referencegrants",
  networkpolicies: "networkpolicies",
  horizontalpodautoscalers: "horizontalpodautoscalers",
  poddisruptionbudgets: "poddisruptionbudgets",
  storageclasses: "storageclasses",
  volumeattributesclasses: "volumeattributesclasses",
  volumesnapshots: "volumesnapshots",
  volumesnapshotcontents: "volumesnapshotcontents",
  volumesnapshotclasses: "volumesnapshotclasses",
  csistoragecapacities: "csistoragecapacities",
};

export function getGlobalTriageManifest(): TriageManifestEntry[] {
  return getAllResourceSchemas()
    .filter((schema) => schema.key in TRIAGE_SCORERS)
    .flatMap((schema) => {
      const command = KUBECTL_COMMANDS[schema.key];
      const scorerId = TRIAGE_SCORERS[schema.key];
      if (!command || !scorerId) return [];
      return [
        {
          key: schema.key,
          title: schema.title,
          domain: schema.domain,
          resourceName: schema.resourceName,
          command,
          scorerId,
          triageMode: "problem_scored",
          fetchKind: "kubectl_list",
          optionalFeature:
            schema.key === "gatewayclasses" ||
            schema.key === "gateways" ||
            schema.key === "httproutes" ||
            schema.key === "referencegrants"
              ? "gateway_api"
              : schema.key === "volumesnapshots" ||
                  schema.key === "volumesnapshotcontents" ||
                  schema.key === "volumesnapshotclasses"
                ? "volume_snapshots"
                : schema.key === "volumeattributesclasses"
                  ? "volume_attributes_class"
                  : "none",
          namespaced: hasResourceCapability(schema.key, "namespaced"),
        } satisfies TriageManifestEntry,
      ];
    });
}
