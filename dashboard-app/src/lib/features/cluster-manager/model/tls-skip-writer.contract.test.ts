import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "src-tauri/src"].map((dir) => join(process.cwd(), dir));
const MODEL = "src/lib/features/cluster-manager/model";

/**
 * Every line of production code that names the flag, in any form.
 * The only writer is the `return skip` line of tls-gate.ts. All the others read
 * the flag, report it, block it in argv, or print a command that turns it off.
 */
const ALLOWED_LINES: Record<string, string[]> = {
  [`${MODEL}/tls-gate.ts`]: [
    "*   - `insecure-skip-tls-verify` is never silently honored — it is an",
    '"insecure-skip-tls-verify disables TLS verification and exposes the connection to " +',
    "* the `server:` line. The only writer of `insecure-skip-tls-verify`.",
    'return skip ? "\\n    insecure-skip-tls-verify: true" : "";',
  ],
  [`${MODEL}/credential-security.ts`]: [
    'description: "insecure-skip-tls-verify is true - vulnerable to man-in-the-middle attacks.",',
    '"Set insecure-skip-tls-verify to false and configure the correct CA certificate.",',
  ],
  [`${MODEL}/credential-hygiene.ts`]: [
    'id: "tls-verify",',
    'detail: "insecure-skip-tls-verify is enabled. Connection is vulnerable to MITM attacks.",',
    '"Disable insecure-skip-tls-verify and configure the correct CA certificate bundle.",',
    'id: "tls-verify",',
  ],
  "src/lib/features/cluster-finder/api/scanner.ts": [
    '"insecure-skip-tls-verify"?: boolean;',
    'insecureSkipTlsVerify: e.cluster?.["insecure-skip-tls-verify"],',
  ],
  "src/lib/entities/config/lib/parseKubeConfig.ts": [
    '"insecure-skip-tls-verify"?: boolean;',
    'insecureSkipTlsVerify: e.cluster?.["insecure-skip-tls-verify"],',
  ],
  "src/lib/shared/lib/readonly-guard.ts": [
    '"--insecure-skip-tls-verify",',
    '"--kube-insecure-skip-tls-verify",',
  ],
  "src/lib/pages/cluster-manager/ui/cluster-manager.svelte": [
    'if (insecureSkipTls || hint.includes("insecure") || hint.includes("skip-tls")) {',
    'warnings.push("insecure-skip-tls-verify enabled");',
  ],
  "src/lib/widgets/cluster/ui/auth-security-panel.svelte": [
    'label: "Edit insecure-skip-tls-verify in kubeconfig",',
    'command: `kubectl config set clusters.${clusterName.replace(/[^A-Za-z0-9._-]/g, "-")}.insecure-skip-tls-verify false`,',
  ],
};

const FLAG_FRAGMENT = /insecure-skip|skip-tls|tls-verify/i;
const STRING_CONCATENATION = /["'`]\s*\+\s*["'`]/g;

function namesTheFlag(line: string): boolean {
  return FLAG_FRAGMENT.test(line.replace(STRING_CONCATENATION, ""));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte|js|mjs|cjs|rs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe("insecure-skip-tls-verify in production code", () => {
  it.each([
    "insecure-skip-tls-verify: true",
    "insecure-skip-tls-verify:true",
    'const cluster = { "insecure-skip-tls-verify": true };',
    "cluster['insecure-skip-tls-verify'] = true;",
    'const key = "insecure-skip-" + "tls-verify";',
    'const key = "insecure-" + "skip-" + "tls-" + "verify";',
    "const line = `insecure-skip-tls-${suffix}: true`;",
    'args.push("--insecure-skip-tls-verify");',
    'run(["config", "set-cluster", name, "--insecure-skip-tls-verify=true"]);',
    "kubectl config set clusters.prod.insecure-skip-tls-verify true",
  ])("recognises the write form: %s", (line) => {
    expect(namesTheFlag(line)).toBe(true);
  });

  it("appears only on the allow-listed lines, so a new writer cannot bypass the gate", () => {
    const found: Record<string, string[]> = {};
    for (const path of ROOTS.flatMap(sourceFiles)) {
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .filter(namesTheFlag)
        .map((line) => line.trim());
      if (lines.length > 0) found[relative(process.cwd(), path)] = lines;
    }
    expect(found).toEqual(ALLOWED_LINES);
  });
});
