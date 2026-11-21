import { path } from "@tauri-apps/api";
import { BaseDirectory, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { load as parseYaml, YAMLException } from "js-yaml";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "$shared/lib/private-files";
import { buildDriftMessage, checkYamlDrift } from "$features/pod-yaml-editor";
import { formatApplyErrorMessage } from "$features/pods-workbench";

/** Which object a YAML tab edits: any kind, built in or custom. */
export type ResourceYamlTarget = {
  /** kubectl resource, e.g. `customresourcedefinitions` or `widgets.example.com`. */
  resource: string;
  name: string;
  namespace?: string;
  namespaceScoped: boolean;
};

/** `kubectl get` for the target; the name last, after `--`, so `--all` stays a name. */
export function buildResourceGetArgs(target: ResourceYamlTarget, output: "yaml" | "json") {
  const args = ["get", target.resource];
  if (target.namespaceScoped && target.namespace) args.push("-n", target.namespace);
  args.push("-o", output, "--request-timeout=10s", "--", target.name);
  return args;
}

export function resourceYamlRef(target: ResourceYamlTarget) {
  return target.namespaceScoped && target.namespace
    ? `${target.namespace}/${target.name}`
    : target.name;
}

export async function loadResourceYaml(clusterId: string, target: ResourceYamlTarget) {
  const response = await kubectlRawArgsFront(buildResourceGetArgs(target, "yaml"), {
    clusterId,
  });
  if (response.errors || response.code !== 0) {
    throw new Error(response.errors || `Failed to load YAML for ${resourceYamlRef(target)}.`);
  }
  return response.output;
}

export type ApplyResourceYamlResult =
  | { status: "applied" }
  | { status: "invalid"; error: string }
  | { status: "drift"; message: string; clusterYaml: string }
  | { status: "failed"; error: string };

/**
 * Applies edited YAML the way the configuration lists do: syntax check, refuse when the
 * object changed in the cluster since it was loaded (drift), server dry-run, then apply,
 * from a private temp file that is removed afterwards.
 */
export async function applyResourceYaml(options: {
  clusterId: string;
  target: ResourceYamlTarget;
  originalYaml: string;
  yamlText: string;
}): Promise<ApplyResourceYamlResult> {
  const { clusterId, target, originalYaml, yamlText } = options;
  const ref = resourceYamlRef(target);
  if (!yamlText.trim()) return { status: "invalid", error: "YAML is empty." };
  try {
    parseYaml(yamlText);
  } catch (error) {
    if (error instanceof YAMLException) {
      const line = typeof error.mark.line === "number" ? error.mark.line + 1 : null;
      return {
        status: "invalid",
        error: line ? `YAML syntax error at line ${line}: ${error.message}` : error.message,
      };
    }
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : "Invalid YAML syntax.",
    };
  }

  const latest = await kubectlRawArgsFront(buildResourceGetArgs(target, "yaml"), { clusterId });
  if (latest.errors || latest.code !== 0) {
    return {
      status: "failed",
      error: latest.errors || "Failed to load current YAML from cluster.",
    };
  }
  const drift = checkYamlDrift(originalYaml, latest.output || "");
  if (drift.hasDrift) {
    return {
      status: "drift",
      message: buildDriftMessage(drift) ?? "The object changed in the cluster since it was loaded.",
      clusterYaml: latest.output || "",
    };
  }

  const relativePath = `tmp/resource-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`;
  try {
    await mkdir("tmp", { recursive: true, baseDir: BaseDirectory.AppData, mode: PRIVATE_DIR_MODE });
    await writeTextFile(relativePath, yamlText, {
      baseDir: BaseDirectory.AppData,
      mode: PRIVATE_FILE_MODE,
    });
    const absolutePath = await path.join(await path.appDataDir(), relativePath);
    const dryRun = await kubectlRawArgsFront(["apply", "--dry-run=server", "-f", absolutePath], {
      clusterId,
    });
    if (dryRun.errors || dryRun.code !== 0) {
      return {
        status: "failed",
        error: formatApplyErrorMessage(dryRun.errors || "Server dry-run failed.", ref),
      };
    }
    const response = await kubectlRawArgsFront(["apply", "-f", absolutePath], { clusterId });
    if (response.errors || response.code !== 0) {
      return {
        status: "failed",
        error: formatApplyErrorMessage(response.errors || "Failed to apply YAML.", ref),
      };
    }
    return { status: "applied" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply YAML.";
    return {
      status: "failed",
      error: /not available|plugin|tauri/i.test(message)
        ? "Apply YAML requires desktop runtime with file-system access."
        : message,
    };
  } finally {
    try {
      await remove(relativePath, { baseDir: BaseDirectory.AppData });
    } catch {
      // A temp file that is already gone is fine.
    }
  }
}
