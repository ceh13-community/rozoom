import {
  buildKubectlDescribeCommand,
  buildKubectlGetYamlCommand,
  buildKubectlLogsArgs,
} from "./kubectl-command-builder";

export type DebugActionInput = {
  resource: string;
  name: string;
  namespace?: string;
  namespaceScoped?: boolean;
  logsTarget?: string;
};

export function buildDebugActions(input: DebugActionInput) {
  const getYaml = buildKubectlGetYamlCommand({
    resource: input.resource,
    name: input.name,
    namespace: input.namespace,
    namespaceScoped: input.namespaceScoped,
  });
  const describe = buildKubectlDescribeCommand({
    resource: input.resource,
    name: input.name,
    namespace: input.namespace,
    namespaceScoped: input.namespaceScoped,
  });
  const logs =
    input.logsTarget &&
    buildKubectlLogsArgs({
      target: input.logsTarget,
      namespace: input.namespace,
    }).join(" ");
  return {
    getYaml,
    describe,
    logs: logs ?? null,
  };
}
