/**
 * Shared `kubectl auth can-i` runner.
 *
 * Extracted from overview-access so mutating flows (batch delete/edit/scale)
 * can preflight permissions with the same semantics as the access overview.
 */

import { kubectlRawArgsFront } from "./kubectl-proxy";

export type CanIStatus = "allowed" | "denied" | "unknown";

export function normalizeCanIStatus(output: string, errors: string, code?: number): CanIStatus {
  if (errors || code !== 0) return "unknown";
  const normalized = output.trim().toLowerCase();
  if (normalized === "yes") return "allowed";
  if (normalized === "no") return "denied";
  return "unknown";
}

/** Runs `kubectl auth can-i <args>` and normalizes the verdict. */
export async function runCanI(clusterId: string, args: string[]): Promise<CanIStatus> {
  const response = await kubectlRawArgsFront(["auth", "can-i", ...args], {
    clusterId,
    allowCommandUnavailable: true,
  });
  return normalizeCanIStatus(response.output, response.errors, response.code);
}
