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

function isLatestOrUntagged(image: string): boolean {
  const atIndex = image.indexOf("@");
  const imageWithoutDigest = atIndex >= 0 ? image.substring(0, atIndex) : image;
  const colonIndex = imageWithoutDigest.lastIndexOf(":");
  if (colonIndex < 0) return true;
  const tag = imageWithoutDigest.substring(colonIndex + 1);
  return tag === "latest";
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
