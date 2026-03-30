import { type Child, Command } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";
import { checkClusterEvent } from "./watcher-parser";

const CONFIG_DIR = "configs";
const WATCH_RESTART_BASE_DELAY_MS = 1_000;
const WATCH_RESTART_MAX_DELAY_MS = 8_000;
const WATCH_MAX_EMPTY_RESTARTS = 6;

export type WatchCallback = (data: string) => void;
export type ErrorCallback = (error: string) => void;

export class KubectlWatcher {
  private child: Child | null = null;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private receivedEventSinceSpawn = false;
  private args = "";
  private clusterId = "";
  private onError: ErrorCallback = () => {};

  async start(args: string, clusterId: string, onError: ErrorCallback): Promise<void> {
    this.stopped = false;
    this.args = args;
    this.clusterId = clusterId;
    this.onError = onError;
    await this.spawn();
  }

  private async spawn(): Promise<void> {
    const appLocalDataDirPath = await appDataDir();
    const kubeconfigPath = `${appLocalDataDirPath}/${CONFIG_DIR}/${this.clusterId}.yaml`;

    const splitArgs = ["--kubeconfig", kubeconfigPath, ...this.args.trim().split(/\s+/)];

    const command = Command.sidecar("binaries/rozoom-kubectl", splitArgs);

    command.on("close", () => {
      this.child = null;
      if (!this.stopped) {
        this.scheduleRestart();
      }
    });

    command.on("error", (error) => {
      this.onError(error);
    });

    command.stdout.on("data", (line: string) => {
      const event = checkClusterEvent(this.clusterId, line);
      if (event) {
        this.receivedEventSinceSpawn = true;
        this.restartAttempts = 0;
      }
    });

    command.stderr.on("data", (line: string) => {
      this.onError(line);
    });

    try {
      this.receivedEventSinceSpawn = false;
      this.child = await command.spawn();
    } catch (error) {
      this.child = null;
      this.onError(error instanceof Error ? error.message : String(error));
      if (!this.stopped) {
        this.scheduleRestart();
      }
    }
  }

  private scheduleRestart() {
    if (this.restartTimer || this.stopped) return;
    if (!this.receivedEventSinceSpawn && this.restartAttempts >= WATCH_MAX_EMPTY_RESTARTS) {
      this.stopped = true;
      this.onError(
        `watch stream exited ${WATCH_MAX_EMPTY_RESTARTS} times without a successful event; stopping restarts`,
      );
      return;
    }
    const delay = Math.min(
      WATCH_RESTART_BASE_DELAY_MS * 2 ** this.restartAttempts,
      WATCH_RESTART_MAX_DELAY_MS,
    );
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopped || this.child) return;
      void this.spawn();
    }, delay);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      await this.child.kill();
      this.child = null;
    }
  }
}
