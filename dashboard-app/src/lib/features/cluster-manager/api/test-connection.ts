/**
 * Write a candidate kubeconfig to a temp file, call `kubectl version
 * --request-timeout=5s` against it, and clean up.
 *
 * Used by the Connect Cluster wizard to let the user validate credentials
 * before persisting anything to the main config store.
 */
import * as Sentry from "@sentry/sveltekit";
import { appDataDir } from "@tauri-apps/api/path";
import { BaseDirectory, mkdir, writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { createCliCommand } from "$shared/api/cli";

const TEST_DIR = "temp-connect-test";

export type TestConnectionResult = {
  success: boolean;
  /** Server git version string extracted from `kubectl version -o json`. */
  serverVersion?: string;
  /** Server platform reported by the API (e.g. linux/amd64). */
  serverPlatform?: string;
  /** Stderr or parsed error message when success is false. */
  error?: string;
  /** Wall-clock duration of the probe including write + exec + cleanup. */
  durationMs: number;
};

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type KubectlVersionJson = {
  serverVersion?: {
    gitVersion?: string;
    platform?: string;
  };
};

function parseServerInfo(stdout: string): {
  serverVersion?: string;
  serverPlatform?: string;
} {
  try {
    const parsed = JSON.parse(stdout) as KubectlVersionJson;
    return {
      serverVersion: parsed.serverVersion?.gitVersion,
      serverPlatform: parsed.serverVersion?.platform,
    };
  } catch {
    return {};
  }
}

/**
 * Write `kubeconfigYaml` to a throwaway file under AppData, run kubectl
 * version against it, then unlink. Never mutates the main config store.
 */
export async function testKubeconfig(kubeconfigYaml: string): Promise<TestConnectionResult> {
  const started = Date.now();
  const id = randomId();
  const relPath = `${TEST_DIR}/${id}.yaml`;
  let absPath: string | null = null;

  try {
    await mkdir(TEST_DIR, { recursive: true, baseDir: BaseDirectory.AppData });
    await writeTextFile(relPath, kubeconfigYaml, { baseDir: BaseDirectory.AppData });
    const home = await appDataDir();
    absPath = `${home}/${relPath}`;

    const command = await createCliCommand("kubectl", [
      "--kubeconfig",
      absPath,
      "version",
      "-o",
      "json",
      "--request-timeout=5s",
    ]);
    const result = await command.execute();
    const code = typeof result.code === "number" ? result.code : 1;
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";

    if (code === 0) {
      const { serverVersion, serverPlatform } = parseServerInfo(stdout);
      return {
        success: true,
        serverVersion,
        serverPlatform,
        durationMs: Date.now() - started,
      };
    }
    return {
      success: false,
      error: stderr.trim() || `kubectl exited with code ${code}`,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    Sentry.captureException(err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  } finally {
    if (absPath) {
      try {
        await remove(relPath, { baseDir: BaseDirectory.AppData });
      } catch {
        /* temp file cleanup is best-effort */
      }
    }
  }
}
