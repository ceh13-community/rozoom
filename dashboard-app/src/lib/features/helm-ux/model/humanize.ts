export interface HumanizedHelmError {
  title: string;
  hint: string | null;
}

/**
 * Map a raw Helm CLI stderr line to a titled error + fix hint.
 * Patterns are case-insensitive substring checks; order matters because the
 * first matching branch wins (the more specific ones come first).
 */
export function humanizeHelmError(raw: string): HumanizedHelmError {
  const lower = raw.toLowerCase();

  if (lower.includes("repository name") && lower.includes("already exists")) {
    return {
      title: "Repository name is taken",
      hint: "Use a different name or remove the existing one.",
    };
  }
  if (lower.includes("could not find") && lower.includes("chart")) {
    return {
      title: "Chart not found",
      hint: "Run helm repo update, or check that the repo prefix matches a configured repository (e.g. bitnami/nginx).",
    };
  }
  if (lower.includes("re-use the name") || lower.includes("cannot re-use")) {
    return {
      title: "Release name conflict",
      hint: "A release with that name already exists in another namespace. Pick a different name.",
    };
  }
  if (lower.includes("has no deployed releases")) {
    return {
      title: "Nothing to rollback",
      hint: "This release has no successful revisions to roll back to. Install it first.",
    };
  }
  if (lower.includes("timed out waiting for the condition")) {
    return {
      title: "Install timed out",
      hint: "Helm waited 3m for workloads to become ready and gave up. Check pods in the namespace for events; the release may still be applying.",
    };
  }
  if (lower.includes("forbidden") || lower.includes("unauthorized")) {
    return {
      title: "Permission denied",
      hint: "Your kubeconfig user lacks RBAC to manage Helm resources in this namespace.",
    };
  }
  if (lower.includes("unable to connect") || lower.includes("connection refused")) {
    return {
      title: "Cluster unreachable",
      hint: "kubectl could not reach the API server. Verify cluster is online and kubeconfig is current.",
    };
  }
  if (lower.includes("yaml:") && lower.includes("error")) {
    return {
      title: "Chart template error",
      hint: "A template or values file has a YAML syntax issue. Run Preview (dry-run) to see the full output.",
    };
  }
  return { title: "Helm action failed", hint: null };
}
