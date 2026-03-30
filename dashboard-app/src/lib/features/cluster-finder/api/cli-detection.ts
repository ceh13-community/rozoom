import { createCliCommand, type CliTool } from "$shared/api/cli";
import { Command } from "@tauri-apps/plugin-shell";
import { homeDir } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import {
  TOOL_REGISTRY,
  BUNDLED_TOOLS,
  CLOUD_CONFIG_PROBES,
  type ToolEntry,
  type InstallManifest,
  type CloudConfigProbe,
} from "$shared/config/tooling";
import type { ClusterProvider } from "$shared/lib/provider-detection";

// ── Public types ─────────────────────────────────────────────────

export type DetectedCli = {
  tool: string;
  provider: ClusterProvider | null;
  available: boolean;
  bundled: boolean;
  planned: boolean;
  version: string | null;
  updatedAt: string | null;
};

export type DetectedOsTool = {
  tool: string;
  provider: ClusterProvider | null;
  available: boolean;
  path: string | null;
  version: string | null;
};

export type DetectedCloudConfig = {
  provider: ClusterProvider;
  label: string;
  configPath: string;
  found: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────

const matchVersion = (s: string) => s.match(/v?(\d+\.\d+[\w.-]*)/)?.[1] ?? null;

function parseVersionFromStdout(tool: string, raw: string): string | null {
  const line = raw.split("\n")[0]?.trim() ?? "";
  if (tool === "gcloud") {
    return line.replace(/^Google Cloud SDK\s*/i, "").trim() || matchVersion(line);
  }
  return matchVersion(line);
}

// ── Bundled CLI detection ────────────────────────────────────────
// Probes bundled sidecar/resource binaries. Version comes from the
// install manifest (instant); the probe only checks ✓/✗ liveness.

async function probeBundledCli(entry: ToolEntry, manifest: InstallManifest): Promise<DetectedCli> {
  const manifestTool = manifest.tools?.[entry.tool];
  const manifestVersion = manifestTool?.version ?? null;
  const updatedAt = manifestTool?.updatedAt ?? null;

  try {
    const command = await createCliCommand(entry.tool as CliTool, entry.probeArgs);
    const result = await command.execute();
    const available = result.code === 0;
    return {
      tool: entry.tool,
      provider: entry.provider,
      available,
      bundled: true,
      planned: false,
      version: manifestVersion,
      updatedAt,
    };
  } catch {
    return {
      tool: entry.tool,
      provider: entry.provider,
      available: false,
      bundled: true,
      planned: false,
      version: manifestVersion,
      updatedAt,
    };
  }
}

export async function detectAvailableClis(manifest: InstallManifest): Promise<DetectedCli[]> {
  const bundled = await Promise.all(BUNDLED_TOOLS.map((e) => probeBundledCli(e, manifest)));

  const planned: DetectedCli[] = TOOL_REGISTRY.filter((t) => t.status === "planned").map((t) => ({
    tool: t.tool,
    provider: t.provider,
    available: false,
    bundled: false,
    planned: true,
    version: null,
    updatedAt: null,
  }));

  return [...bundled, ...planned];
}

// ── OS tool detection (system PATH) ──────────────────────────────

async function probeOsTool(entry: ToolEntry): Promise<DetectedOsTool> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-deprecated -- runtime guard for SSR; no alternative to navigator.platform
    const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.platform ?? "");
    const whichCmd = isWindows ? "where.exe" : "which";
    const whichResult = await Command.create(whichCmd, [entry.tool]).execute();
    if (whichResult.code !== 0) {
      return {
        tool: entry.tool,
        provider: entry.provider,
        available: false,
        path: null,
        version: null,
      };
    }
    const stdout = typeof whichResult.stdout === "string" ? whichResult.stdout : "";
    const toolPath = stdout.trim().split("\n")[0]?.trim() ?? null;

    let version: string | null = null;
    try {
      const args = entry.osVersionArgs ?? entry.probeArgs;
      const versionResult = await Command.create(entry.tool, args).execute();
      if (versionResult.code === 0) {
        const vOut = typeof versionResult.stdout === "string" ? versionResult.stdout : "";
        version = parseVersionFromStdout(entry.tool, vOut);
      }
    } catch {
      /* version detection is best-effort */
    }

    return { tool: entry.tool, provider: entry.provider, available: true, path: toolPath, version };
  } catch {
    return {
      tool: entry.tool,
      provider: entry.provider,
      available: false,
      path: null,
      version: null,
    };
  }
}

export async function detectOsTools(): Promise<DetectedOsTool[]> {
  return Promise.all(TOOL_REGISTRY.map(probeOsTool));
}

// ── Cloud config detection ───────────────────────────────────────

async function probeCloudConfig(
  home: string,
  probe: CloudConfigProbe,
): Promise<DetectedCloudConfig> {
  const fullPath = `${home}/${probe.relPath}`;
  try {
    const found = await exists(fullPath);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- defensive coercion, exists() return type varies across Tauri versions
    return { provider: probe.provider, label: probe.label, configPath: fullPath, found: !!found };
  } catch {
    return { provider: probe.provider, label: probe.label, configPath: fullPath, found: false };
  }
}

export async function detectCloudConfigs(): Promise<DetectedCloudConfig[]> {
  try {
    const home = await homeDir();
    const homePath = home.endsWith("/") ? home.slice(0, -1) : home;
    const results = await Promise.all(
      CLOUD_CONFIG_PROBES.map((probe) => probeCloudConfig(homePath, probe)),
    );
    return results.filter((r) => r.found);
  } catch {
    return [];
  }
}
