/**
 * Shared RBAC "forbidden" detection and humanization.
 *
 * Single source of truth for recognizing permission errors in kubectl/API
 * output; previously duplicated across check-health, alerts-hub and armor-hub.
 */

const FORBIDDEN_MARKERS = [
  "forbidden",
  "unauthorized",
  "permission",
  "system:unauthenticated",
  "cannot create resource",
] as const;

export function isForbiddenMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return FORBIDDEN_MARKERS.some((marker) => normalized.includes(marker));
}

export type ForbiddenActionContext = {
  verb: string;
  resource: string;
  name?: string;
  namespace?: string;
};

export function humanizeForbiddenAction(context: ForbiddenActionContext): string {
  const target = context.name ? `${context.resource} "${context.name}"` : context.resource;
  const scope = context.namespace ? ` in namespace "${context.namespace}"` : "";
  return (
    `Your cluster user is not allowed to ${context.verb} ${target}${scope}. ` +
    `Ask your cluster administrator for the "${context.verb}" permission on ${context.resource}, ` +
    `or switch to a kubeconfig context that has it.`
  );
}
