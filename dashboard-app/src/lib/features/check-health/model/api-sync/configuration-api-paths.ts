import type { WorkloadType } from "$shared/model/workloads";

const CONFIGURATION_API_PATHS: Partial<Record<WorkloadType, string[]>> = {
  namespaces: ["/api/v1/namespaces"],
  configmaps: ["/api/v1/configmaps"],
  secrets: ["/api/v1/secrets"],
  resourcequotas: ["/api/v1/resourcequotas"],
  limitranges: ["/api/v1/limitranges"],
  horizontalpodautoscalers: ["/apis/autoscaling/v2/horizontalpodautoscalers"],
  poddisruptionbudgets: ["/apis/policy/v1/poddisruptionbudgets"],
  priorityclasses: ["/apis/scheduling.k8s.io/v1/priorityclasses"],
  runtimeclasses: ["/apis/node.k8s.io/v1/runtimeclasses"],
  leases: ["/apis/coordination.k8s.io/v1/leases"],
  mutatingwebhookconfigurations: [
    "/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations",
  ],
  validatingwebhookconfigurations: [
    "/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations",
  ],
  serviceaccounts: ["/api/v1/serviceaccounts"],
  roles: ["/apis/rbac.authorization.k8s.io/v1/roles"],
  rolebindings: ["/apis/rbac.authorization.k8s.io/v1/rolebindings"],
  clusterroles: ["/apis/rbac.authorization.k8s.io/v1/clusterroles"],
  clusterrolebindings: ["/apis/rbac.authorization.k8s.io/v1/clusterrolebindings"],
  customresourcedefinitions: ["/apis/apiextensions.k8s.io/v1/customresourcedefinitions"],
  services: ["/api/v1/services"],
  endpoints: ["/api/v1/endpoints"],
  endpointslices: ["/apis/discovery.k8s.io/v1/endpointslices"],
  ingresses: ["/apis/networking.k8s.io/v1/ingresses"],
  ingressclasses: ["/apis/networking.k8s.io/v1/ingressclasses"],
  gatewayclasses: [
    "/apis/gateway.networking.k8s.io/v1/gatewayclasses",
    "/apis/gateway.networking.k8s.io/v1beta1/gatewayclasses",
  ],
  gateways: [
    "/apis/gateway.networking.k8s.io/v1/gateways",
    "/apis/gateway.networking.k8s.io/v1beta1/gateways",
  ],
  httproutes: [
    "/apis/gateway.networking.k8s.io/v1/httproutes",
    "/apis/gateway.networking.k8s.io/v1beta1/httproutes",
  ],
  referencegrants: [
    "/apis/gateway.networking.k8s.io/v1/referencegrants",
    "/apis/gateway.networking.k8s.io/v1beta1/referencegrants",
  ],
  networkpolicies: ["/apis/networking.k8s.io/v1/networkpolicies"],
  persistentvolumeclaims: ["/api/v1/persistentvolumeclaims"],
  persistentvolumes: ["/api/v1/persistentvolumes"],
  storageclasses: ["/apis/storage.k8s.io/v1/storageclasses"],
  volumeattributesclasses: ["/apis/storage.k8s.io/v1beta1/volumeattributesclasses"],
  volumesnapshots: ["/apis/snapshot.storage.k8s.io/v1/volumesnapshots"],
  volumesnapshotcontents: ["/apis/snapshot.storage.k8s.io/v1/volumesnapshotcontents"],
  volumesnapshotclasses: ["/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses"],
  csistoragecapacities: ["/apis/storage.k8s.io/v1/csistoragecapacities"],
};

export function getConfigurationApiPaths(workloadType: WorkloadType) {
  return CONFIGURATION_API_PATHS[workloadType] ?? [];
}
