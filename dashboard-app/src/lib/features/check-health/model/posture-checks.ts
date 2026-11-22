import { checkHpaStatus } from "../api/check-hpa";
import { checkIngressStatus } from "../api/check-ingress-status";
import { checkRbacOverview } from "../api/check-rbac-overview";
import { checkVpaStatus } from "../api/check-vpa-status";
import { updateClusterCheckPartially } from "./cache-store";
import type { ClusterHealthChecks } from "./types";

/**
 * Reports the posture score reads that config diagnostics leave out. HPA and VPA need
 * live reads that the fleet cards skip on purpose (many clusters at once); Ingress TLS
 * and RBAC belong to the infrastructure scope that only the Detailed card loads. Without
 * them five of the score's rules never ran on the Overview of a cluster.
 */
export const POSTURE_CHECK_FIELDS = [
  "hpaStatus",
  "vpaStatus",
  "ingressStatus",
  "rbacOverview",
] as const;

export type PostureCheckField = (typeof POSTURE_CHECK_FIELDS)[number];

/** Older reports are read again; the checks keep their own short cache on top. */
export const POSTURE_CHECK_MAX_AGE_MS = 10 * 60_000;

type PostureReport = { status?: unknown; updatedAt?: unknown } | null | undefined;

/** Fields with no report, a placeholder report (status unknown) or one older than the max age. */
export function missingPostureChecks(
  check: ClusterHealthChecks | null,
  now: number = Date.now(),
): PostureCheckField[] {
  return POSTURE_CHECK_FIELDS.filter((field) => {
    const report = check?.[field] as PostureReport;
    if (!report || report.status === "unknown") return true;
    return (
      typeof report.updatedAt !== "number" || now - report.updatedAt > POSTURE_CHECK_MAX_AGE_MS
    );
  });
}

type Runners = Record<PostureCheckField, (clusterId: string) => Promise<unknown>>;

const defaultRunners: Runners = {
  hpaStatus: (clusterId) => checkHpaStatus(clusterId),
  vpaStatus: (clusterId) => checkVpaStatus(clusterId),
  ingressStatus: (clusterId) => checkIngressStatus(clusterId),
  rbacOverview: (clusterId) => checkRbacOverview(clusterId),
};

/**
 * Runs the given checks in parallel and stores what came back in one partial update.
 * A check that fails is left out, so the score keeps showing its rule as not checked.
 */
export async function loadPostureChecks(
  clusterId: string,
  fields: readonly PostureCheckField[],
  runners: Runners = defaultRunners,
  store: typeof updateClusterCheckPartially = updateClusterCheckPartially,
): Promise<PostureCheckField[]> {
  const results = await Promise.all(
    fields.map(async (field) => {
      try {
        return [field, await runners[field](clusterId)] as const;
      } catch {
        return [field, null] as const;
      }
    }),
  );
  const loaded = results.filter(([, report]) => report != null);
  if (loaded.length > 0) {
    await store(clusterId, Object.fromEntries(loaded) as Partial<ClusterHealthChecks>);
  }
  return loaded.map(([field]) => field);
}
