import { type Child, Command } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";
import { dispatchClusterEvent, type EventParser } from "./watcher-parser";

const CONFIG_DIR = "configs";
const WATCH_RESTART_BASE_DELAY_MS = 1_000;
const WATCH_RESTART_MAX_DELAY_MS = 8_000;
const WATCH_MAX_EMPTY_RESTARTS = 6;
// kubectl ends a watch on --request-timeout (300 s) even when nothing failed.
// A stream that stayed up this long was healthy, so its exit does not count
// towards the empty-restart limit. Without this a quiet list lost its watch
// after six request timeouts (about 30 minutes) and never got it back.
const WATCH_HEALTHY_RUN_MS = 30_000;

export type WatchCallback = (data: string) => void;
export type ErrorCallback = (error: string) => void;

export class KubectlWatcher {
  private child: Child | null = null;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private receivedEventSinceSpawn = false;
  private spawnedAt = 0;
  private args = "";
  private clusterId = "";
  private parser: EventParser = () => null;
  private onError: ErrorCallback = () => {};

  async start(
    args: string,
    clusterId: string,
    onError: ErrorCallback,
    parser: EventParser,
  ): Promise<void> {
    this.stopped = false;
    this.args = args;
    this.clusterId = clusterId;
    this.parser = parser;
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
      if (this.spawnedAt > 0 && Date.now() - this.spawnedAt >= WATCH_HEALTHY_RUN_MS) {
        this.restartAttempts = 0;
      }
      if (!this.stopped) {
        this.scheduleRestart();
      }
    });

    command.on("error", (error) => {
      this.onError(error);
    });

    command.stdout.on("data", (line: string) => {
      const event = dispatchClusterEvent(this.clusterId, line, this.parser);
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
      this.spawnedAt = Date.now();
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
