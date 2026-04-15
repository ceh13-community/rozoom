import { Command, type IOPayload, type Child } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";
import { CONFIG_DIR } from "$entities/config/model/appConfig";

export type CliTool =
  | "kubectl"
  | "helm"
  | "doctl"
  | "aws"
  | "gcloud"
  | "pluto"
  | "velero"
  | "kustomize"
  | "kubeconform"
  | "stern"
  | "yq"
  | "hcloud"
  | "oc"
  | "az"
  | "curl"
  | "doggo"
  | "grpcurl"
  | "websocat"
  | "tcping"
  | "trivy";

type SpawnResult = {
  command: Command<IOPayload>;
  child: Child;
};

// Mapping from CliTool name to actual sidecar binary name.
// All sidecars use "binaries/rozoom-<tool>" prefix to avoid /usr/bin conflicts.
const SIDECAR_NAME_MAP: Partial<Record<CliTool, string>> = {
  gcloud: "binaries/rozoom-gcloud-cli",
  az: "binaries/rozoom-az-cli",
};

// Tools bundled as Tauri resources (not sidecars).
const RESOURCE_TOOLS: ReadonlySet<CliTool> = new Set(["aws"]);

// eslint-disable-next-line @typescript-eslint/require-await -- async kept for consistent API with other CLI functions
export async function createCliCommand(tool: CliTool, args: string[]): Promise<Command<IOPayload>> {
  if (RESOURCE_TOOLS.has(tool)) {
    return Command.create(`${tool}-bundled`, args);
  }

  const sidecarName = SIDECAR_NAME_MAP[tool] ?? `binaries/rozoom-${tool}`;
  return Command.sidecar(sidecarName, args);
}

export async function spawnCli(
  tool: CliTool,
  args: string[],
  handlers?: {
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    onClose?: (e: unknown) => void;
    onError?: (e: unknown) => void;
  },
): Promise<SpawnResult> {
  const command = await createCliCommand(tool, args);

  if (handlers?.onStdoutLine) {
    command.stdout.on("data", (line) => {
      handlers.onStdoutLine?.(String(line));
    });
  }

  if (handlers?.onStderrLine) {
    command.stderr.on("data", (line) => {
      handlers.onStderrLine?.(String(line));
    });
  }

  if (handlers?.onClose) {
    command.on("close", (e) => {
      handlers.onClose?.(e);
    });
  }

  if (handlers?.onError) {
    command.on("error", (e) => {
      handlers.onError?.(e);
    });
  }

  const child = await command.spawn();
  return { command, child };
}

/**
 * Detect the platform shell.  Linux/macOS use `sh -c`, Windows uses `cmd /C`.
 */
function getPlatformShell(): { name: string; args: (cmd: string) => string[] } {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-deprecated
  const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.platform ?? "");
  return isWindows
    ? { name: "cmd", args: (cmd) => ["/C", cmd] }
    : { name: "sh", args: (cmd) => ["-c", cmd] };
}

/**
 * Run an arbitrary shell command via the platform shell.
 * Linux/macOS: `sh -c <command>`, Windows: `cmd /C <command>`.
 * Used by the debug terminal to support basic OS commands
 * (ls, cat, grep, cp, mv, rm, mkdir, echo, etc.).
 */
export async function execShellCommand(
  commandLine: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const shell = getPlatformShell();
  const command = Command.create(shell.name, shell.args(commandLine));

  let stdout = "";
  let stderr = "";

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
  command.stdout.on("data", (line) => (stdout += String(line)));
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
  command.stderr.on("data", (line) => (stderr += String(line)));

  // Attach close listener BEFORE spawn to avoid race condition
  // where fast commands (pwd, cd, echo) finish before the listener is set up.
  const closePromise = new Promise<number>((resolve) => {
    command.on("close", (e: unknown) => {
      if (typeof e === "object" && e !== null && "code" in e) {
        const v = (e as { code?: unknown }).code;
        resolve(typeof v === "number" ? v : 0);
        return;
      }
      resolve(0);
    });
  });

  await command.spawn();
  const code = await closePromise;

  return { code, stdout, stderr };
}

const KUBECONFIG_TOOLS: ReadonlySet<CliTool> = new Set([
  "kubectl",
  "helm",
  "stern",
  "velero",
  "kustomize",
  "pluto",
]);

export async function resolveKubeconfigPath(clusterId: string): Promise<string> {
  const dataDir = await appDataDir();
  const safeId = clusterId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${dataDir}/${CONFIG_DIR}/${safeId}.yaml`;
}

export async function execCliForCluster(
  tool: CliTool,
  args: string[],
  clusterId: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const kubeconfigPath = await resolveKubeconfigPath(clusterId);
  const fullArgs = KUBECONFIG_TOOLS.has(tool) ? ["--kubeconfig", kubeconfigPath, ...args] : args;
  return execCli(tool, fullArgs);
}

export async function execCli(
  tool: CliTool,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = await createCliCommand(tool, args);

  let stdout = "";
  let stderr = "";

  command.stdout.on("data", (line) => (stdout += String(line)));
  command.stderr.on("data", (line) => (stderr += String(line)));

  const closePromise = new Promise<number>((resolve) => {
    command.on("close", (e: unknown) => {
      if (typeof e === "object" && e !== null && "code" in e) {
        const v = (e as { code?: unknown }).code;
        resolve(typeof v === "number" ? v : 0);
        return;
      }
      resolve(0);
    });
  });

  await command.spawn();
  const code = await closePromise;

  return { code, stdout, stderr };
}
