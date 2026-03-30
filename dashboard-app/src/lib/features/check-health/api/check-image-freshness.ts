import type { ImageFreshnessReport } from "../model/types";

export type ContainerImageInput = {
  image: string;
};

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
    updatedAt: Date.now(),
  };
}
