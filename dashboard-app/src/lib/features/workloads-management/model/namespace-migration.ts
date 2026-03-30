/**
 * Namespace Migration Tool (#7)
 *
 * Generates migration plan for copying resources between namespaces.
 */

export type MigrationResource = { kind: string; name: string; sourceNamespace: string };
export type MigrationStep = {
  resource: MigrationResource;
  action: "export" | "transform" | "apply";
  kubectlArgs: string[];
};
export type MigrationPlan = {
  sourceNamespace: string;
  targetNamespace: string;
  steps: MigrationStep[];
  totalSteps: number;
  warnings: string[];
};

export function buildMigrationPlan(
  resources: MigrationResource[],
  targetNamespace: string,
): MigrationPlan {
  const warnings: string[] = [];
  const steps: MigrationStep[] = [];

  for (const res of resources) {
    steps.push({
      resource: res,
      action: "export",
      kubectlArgs: [
        "get",
        res.kind.toLowerCase(),
        res.name,
        "-n",
        res.sourceNamespace,
        "-o",
        "yaml",
      ],
    });
    steps.push({
      resource: res,
      action: "transform",
      kubectlArgs: [], // namespace replacement done in-memory
    });
    steps.push({
      resource: res,
      action: "apply",
      kubectlArgs: ["apply", "-n", targetNamespace, "-f", "-"],
    });

    if (res.kind.toLowerCase() === "secret" || res.kind.toLowerCase() === "configmap") {
      warnings.push(`${res.kind} "${res.name}" may contain namespace-specific references`);
    }
  }

  return {
    sourceNamespace: resources[0]?.sourceNamespace ?? "",
    targetNamespace,
    steps,
    totalSteps: steps.length,
    warnings,
  };
}
