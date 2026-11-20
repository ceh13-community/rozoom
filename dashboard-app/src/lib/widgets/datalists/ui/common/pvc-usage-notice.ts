/** States of the PVC disk usage block that are not a usage bar. */
export type PvcUsageNotice = { kind: "info" | "error"; text: string };

export const PVC_USAGE_NOTICES = {
  // Not a failure: usage comes from the node of a pod that uses the claim.
  noPodUsesClaim: {
    kind: "info",
    text: "Usage is shown while a pod uses this claim. No pod uses it now.",
  },
  cannotListPods: {
    kind: "error",
    text: "Could not list pods in this namespace. Check that you can run get pods there.",
  },
  cannotReadNodeStats: {
    kind: "error",
    text: "Could not read volume stats from the node. This needs access to the node stats endpoint (nodes/proxy).",
  },
  noStatsForClaim: {
    kind: "info",
    text: "The node reported no usage for this claim. Some storage drivers do not provide it.",
  },
  failed: { kind: "error", text: "Could not read disk usage. Try again." },
} as const satisfies Record<string, PvcUsageNotice>;

export const DISK_USAGE_HINT =
  "Used space on the volume, reported by the node that runs a pod using it.";
