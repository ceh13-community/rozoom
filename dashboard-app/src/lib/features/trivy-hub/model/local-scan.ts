/**
 * Local Trivy scan runner.
 *
 * Uses the bundled `trivy` sidecar to do an ad-hoc `trivy k8s` scan
 * against the currently-selected cluster, without requiring the Trivy
 * Operator to be installed in-cluster. Results are parsed into the same
 * VulnItem / MisconfigItem / SecretItem shapes the panel already renders
 * from operator CRDs, so the UI can merge both sources into the same
 * tables.
 *
 * Intentionally independent of the operator path: no CRDs, no RBAC in
 * the target cluster, no writes. Works on strictly read-only prod
 * clusters where installing Trivy Operator is not acceptable.
 */

import { execCliForCluster, resolveKubeconfigPath } from "$shared/api/cli";
import type { ConsoleSession } from "$shared/ui/command-console";

export type ScanSource = "operator" | "local";

export interface LocalVulnItem {
  namespace: string;
  resource: string;
  image: string;
  vulnerabilityID: string;
  severity: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion: string;
  title: string;
  primaryLink: string;
  score: number;
  source: ScanSource;
}

export interface LocalMisconfigItem {
  namespace: string;
  resource: string;
  checkID: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  messages: string[];
  source: ScanSource;
}

export interface LocalSecretItem {
  namespace: string;
  resource: string;
  ruleID: string;
  severity: string;
  category: string;
  title: string;
  target: string;
  match: string;
  source: ScanSource;
}

export interface LocalScanResult {
  success: boolean;
  error?: string;
  vulns: LocalVulnItem[];
  misconfigs: LocalMisconfigItem[];
  secrets: LocalSecretItem[];
}

// Trivy k8s JSON output shapes. Only the fields we read are typed — the
// real payload is much larger and evolves between trivy versions.
type RawResource = {
  Namespace?: string;
  Kind?: string;
  Name?: string;
  Results?: RawResult[];
};
type RawResult = {
  Target?: string;
  Vulnerabilities?: RawVulnerability[];
  Misconfigurations?: RawMisconfiguration[];
  Secrets?: RawSecret[];
};
type RawVulnerability = {
  VulnerabilityID?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Severity?: string;
  Title?: string;
  PrimaryURL?: string;
  CVSS?: Record<string, { V3Score?: number } | undefined>;
};
type RawMisconfiguration = {
  ID?: string;
  AVDID?: string;
  Severity?: string;
  Title?: string;
  Description?: string;
  Message?: string;
  References?: string[];
  Namespace?: string;
};
type RawSecret = {
  RuleID?: string;
  Severity?: string;
  Title?: string;
  Category?: string;
  Match?: string;
  StartLine?: number;
};

function cvssScore(cvss: RawVulnerability["CVSS"]): number {
  if (!cvss) return 0;
  const nvd = cvss.nvd?.V3Score;
  if (typeof nvd === "number") return nvd;
  for (const key of Object.keys(cvss)) {
    const v = cvss[key]?.V3Score;
    if (typeof v === "number") return v;
  }
  return 0;
}

/**
 * Run `trivy k8s` against the cluster and stream output into the
 * session. Returns the parsed result plus a raw success/error flag.
 *
 * Command shape:
 *   trivy k8s --kubeconfig <path> --report all --format json
 *             --quiet --timeout 5m
 *
 * `--report all` gives per-resource findings (default is summary-only
 * which loses everything the tables need). `--quiet` suppresses the
 * progress bar so the console transcript stays readable.
 *
 * No positional arg: in trivy 0.50+ the first positional on
 * `trivy k8s` is a context name (not a scope keyword), so passing the
 * literal "cluster" fails with `context "cluster" does not exist`.
 * Omitting it makes trivy use the kubeconfig's current-context, which
 * is exactly what we want since the kubeconfig file is scoped to a
 * single target cluster.
 */
export async function runLocalTrivyK8sScan(
  clusterId: string,
  session: ConsoleSession,
): Promise<LocalScanResult> {
  const kubeconfigPath = await resolveKubeconfigPath(clusterId);
  const args = [
    "k8s",
    "--kubeconfig",
    kubeconfigPath,
    "--report",
    "all",
    "--format",
    "json",
    "--quiet",
    "--timeout",
    "5m",
  ];

  session.append(`$ trivy ${args.join(" ")}\n`);
  const raw = await execCliForCluster("trivy", args, clusterId).catch((err: unknown) => ({
    code: 1,
    stdout: "",
    stderr: err instanceof Error ? err.message : String(err),
  }));

  // Trivy writes the progress banner + final summary line to stderr even
  // with --quiet on some versions, so surface it to the transcript. The
  // JSON payload lands on stdout.
  if (raw.stderr) session.append(raw.stderr);

  if (raw.code !== 0 && !raw.stdout.trim()) {
    return {
      success: false,
      error: raw.stderr.trim() || `trivy exited with code ${raw.code}`,
      vulns: [],
      misconfigs: [],
      secrets: [],
    };
  }

  let parsed: { Resources?: RawResource[] } | null = null;
  try {
    parsed = JSON.parse(raw.stdout) as { Resources?: RawResource[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.append(`  parse error: ${message}\n`);
    return {
      success: false,
      error: `Failed to parse trivy JSON: ${message}`,
      vulns: [],
      misconfigs: [],
      secrets: [],
    };
  }

  const vulns: LocalVulnItem[] = [];
  const misconfigs: LocalMisconfigItem[] = [];
  const secrets: LocalSecretItem[] = [];

  for (const res of parsed.Resources ?? []) {
    const namespace = res.Namespace ?? "";
    const kind = res.Kind ?? "";
    const name = res.Name ?? "";
    const resource = kind && name ? `${kind}-${name}` : name || kind || "-";
    for (const r of res.Results ?? []) {
      const image = r.Target ?? "";
      for (const v of r.Vulnerabilities ?? []) {
        vulns.push({
          namespace,
          resource,
          image,
          vulnerabilityID: v.VulnerabilityID ?? "",
          severity: (v.Severity ?? "UNKNOWN").toLowerCase(),
          pkgName: v.PkgName ?? "",
          installedVersion: v.InstalledVersion ?? "",
          fixedVersion: v.FixedVersion ?? "",
          title: v.Title ?? "",
          primaryLink: v.PrimaryURL ?? "",
          score: cvssScore(v.CVSS),
          source: "local",
        });
      }
      for (const m of r.Misconfigurations ?? []) {
        misconfigs.push({
          namespace,
          resource,
          checkID: m.AVDID ?? m.ID ?? "",
          severity: (m.Severity ?? "UNKNOWN").toLowerCase(),
          category: "",
          title: m.Title ?? "",
          description: m.Description ?? "",
          messages: m.Message ? [m.Message] : [],
          source: "local",
        });
      }
      for (const s of r.Secrets ?? []) {
        secrets.push({
          namespace,
          resource,
          ruleID: s.RuleID ?? "",
          severity: (s.Severity ?? "UNKNOWN").toLowerCase(),
          category: s.Category ?? "",
          title: s.Title ?? "",
          target: r.Target ?? "",
          match: s.Match ?? "",
          source: "local",
        });
      }
    }
  }

  session.append(
    `  found ${vulns.length} vulnerabilities, ${misconfigs.length} misconfigs, ${secrets.length} secrets\n`,
  );

  return { success: true, vulns, misconfigs, secrets };
}
