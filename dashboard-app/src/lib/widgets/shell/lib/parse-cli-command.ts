import type { CliTool } from "$shared/api/cli";
import { tokenizeCommand } from "./tokenize-command";

export const SUPPORTED_CLI_TOOLS: Record<string, CliTool> = {
  kubectl: "kubectl",
  helm: "helm",
  stern: "stern",
  velero: "velero",
  kustomize: "kustomize",
  kubeconform: "kubeconform",
  pluto: "pluto",
  yq: "yq",
  doctl: "doctl",
  aws: "aws",
  gcloud: "gcloud",
  hcloud: "hcloud",
  oc: "oc",
  az: "az",
  curl: "curl",
  doggo: "doggo",
  grpcurl: "grpcurl",
  websocat: "websocat",
  tcping: "tcping",
  trivy: "trivy",
};

export type ParsedCommand =
  | { kind: "cli"; tool: CliTool; args: string[] }
  | { kind: "shell" }
  | { kind: "invalid"; error: string };

/**
 * Decide how a command typed into the terminal runs: a bundled tool directly with an
 * argument list, anything else through the platform shell. A command that cannot be
 * parsed runs nowhere; handing it to the shell would give it a different meaning.
 */
export function parseCliCommand(command: string): ParsedCommand {
  const result = tokenizeCommand(command);
  if (!result.ok) return { kind: "invalid", error: result.error };
  const [head, ...args] = result.tokens;
  const tool = Object.hasOwn(SUPPORTED_CLI_TOOLS, head) ? SUPPORTED_CLI_TOOLS[head] : null;
  return tool ? { kind: "cli", tool, args } : { kind: "shell" };
}
