import { error } from "@sveltejs/kit";
import { WORKLOAD_LABEL_OVERRIDES } from "$lib/pages/cluster/model/cluster-page-workload-config";

type PageLoad = {
  params: {
    title: string;
    slug: string;
    workload: ValidWorkload | null;
    sort_field: string | null;
  };
  url: URL;
};

const VALID_WORKLOADS = [
  "pods",
  "deployments",
  "daemonsets",
  "overview",
  "globaltriage",
  "statefulsets",
  "replicasets",
  "replicationcontrollers",
  "jobs",
  "cronjobs",
  "cronjobshealth",
  "podsrestarts",
  "deprecationscan",
  "versionaudit",
  "backupaudit",
  "helm",
  "helmcatalog",
  "alertshub",
  "armorhub",
  "metricssources",
  "compliancehub",
  "trivyhub",
  "nodesstatus",
  "nodespressures",
  "namespaces",
  "configmaps",
  "secrets",
  "resourcequotas",
  "limitranges",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "priorityclasses",
  "runtimeclasses",
  "leases",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "accessreviews",
  "customresourcedefinitions",
  "services",
  "endpoints",
  "endpointslices",
  "ingresses",
  "ingressclasses",
  "gatewayclasses",
  "gateways",
  "httproutes",
  "referencegrants",
  "portforwarding",
  "networkpolicies",
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
  "volumeattributesclasses",
  "volumesnapshots",
  "volumesnapshotcontents",
  "volumesnapshotclasses",
  "csistoragecapacities",
  "rotatecerts",
  "gitopsbootstrap",
  "capacityintelligence",
  "performanceobs",
  "securityaudit",
  "authsecurity",
  "plugins",
  "visualizer",
  "resourcemap",
] as const;

type ValidWorkload = (typeof VALID_WORKLOADS)[number];

function isValidWorkload(workload: string | null): workload is ValidWorkload {
  return workload !== null && VALID_WORKLOADS.includes(workload as ValidWorkload);
}

export const load = ({ params, url }: PageLoad) => {
  if (!params.slug) {
    return error(404, "Not found");
  }

  const workload = url.searchParams.get("workload");
  const sortField = url.searchParams.get("sort_field");
  if (workload && !isValidWorkload(workload)) {
    return error(
      400,
      `Invalid workload type: ${workload}. Valid types are: ${VALID_WORKLOADS.join(", ")}`,
    );
  }

  const getTitle = (cluster: string, workloadType: string | null) => {
    const workloadName = workloadType
      ? (WORKLOAD_LABEL_OVERRIDES[workloadType] ??
        workloadType.charAt(0).toUpperCase() + workloadType.slice(1))
      : "Pods";
    return `${workloadName} - Cluster: ${cluster}`;
  };

  return {
    title: getTitle(params.slug, workload),
    slug: params.slug,
    workload: workload as ValidWorkload | null,
    sort_field: sortField,
  };
};
