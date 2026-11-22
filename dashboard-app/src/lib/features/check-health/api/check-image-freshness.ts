import type { PodItem } from "$shared/model/clusters";
import type { ImageFreshnessReport } from "../model/types";

export type ContainerImageInput = {
  image: string;
  namespace?: string;
  pod?: string;
  container?: string;
};

type PodContainers = Partial<Record<"containers" | "initContainers", unknown>>;

/** Every container and init container of the pods, with where it runs. */
export function podContainerImages(pods: PodItem[]): ContainerImageInput[] {
  return pods.flatMap((pod) => {
    // Lightweight pod lists can come without a spec, whatever the type says.
    const spec = (pod as { spec?: PodContainers }).spec ?? {};
    const containers = [spec.initContainers, spec.containers].flatMap((list) =>
      Array.isArray(list) ? (list as Array<{ name?: string; image?: string }>) : [],
    );
    return containers
      .filter((container) => typeof container.image === "string" && container.image.length > 0)
      .map((container) => ({
        image: container.image as string,
        namespace: pod.metadata.namespace,
        pod: pod.metadata.name,
        container: container.name ?? "",
      }));
  });
}

// A digest pins the image whatever the tag says: the kubelet pulls by the digest. The tag
// is what follows ":" in the last path segment; a ":" before the last "/" is a registry port.
function isLatestOrUntagged(image: string): boolean {
  if (image.includes("@")) return false;
  const name = image.slice(image.lastIndexOf("/") + 1);
  const colonIndex = name.lastIndexOf(":");
  return colonIndex < 0 || name.slice(colonIndex + 1) === "latest";
}

function hasNoDigest(image: string): boolean {
  return !image.includes("@sha256:");
}

export function checkImageFreshness(containers: ContainerImageInput[]): ImageFreshnessReport {
  const totalContainers = containers.length;
  let latestTagCount = 0;
  let noDigestCount = 0;

  for (const container of containers) {
    if (isLatestOrUntagged(container.image)) {
      latestTagCount++;
    }
    if (hasNoDigest(container.image)) {
      noDigestCount++;
    }
  }

  const status = latestTagCount > 0 ? "warning" : "ok";

  return {
    status,
    summary: {
      totalContainers,
      latestTagCount,
      noDigestCount,
    },
    items: containers
      .filter((container) => isLatestOrUntagged(container.image))
      .map((container) => ({
        namespace: container.namespace ?? "",
        pod: container.pod ?? "",
        container: container.container ?? "",
        image: container.image,
      })),
    updatedAt: Date.now(),
  };
}
