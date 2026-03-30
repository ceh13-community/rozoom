import { error } from "@tauri-apps/plugin-log";
import { getAllPods, getClusterDaemonsets } from "$shared/api/tauri";
import type { PodItem } from "$shared/model/clusters";

const LABELS = ["app.kubernetes.io/name", "app", "job"] as const;
const SERVICE_NAME = "node-exporter";

export const findPrometheusNodeExporter = async (clusterId: string) => {
  let daemonSetPods: PodItem[] = [];

  for (const label of LABELS) {
    try {
      const json = await getClusterDaemonsets(clusterId, "all");
      const daemonset = json?.items.find(
        (ds) =>
          ds.metadata.labels?.[label]?.includes(SERVICE_NAME) ||
          ds.metadata.labels?.[label]?.includes("prometheus-node-exporter"),
      );

      if (daemonset) {
        const ns = daemonset.metadata.namespace || "default";
        const name = daemonset.metadata.name;

        const allPods = await getAllPods(clusterId);
        daemonSetPods = allPods.filter(
          (pod) =>
            pod.metadata.namespace === ns &&
            pod.metadata.ownerReferences?.some(
              (ref) => ref.kind === "DaemonSet" && ref.name === name,
            ),
        );

        if (daemonSetPods.length > 0) break;
      }
    } catch (err) {
      await error(`Error checking DaemonSet with label ${label}: ${err}`);
      continue;
    }
  }

  return daemonSetPods;
};
