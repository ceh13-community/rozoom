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

// The list that pairs with each watch run starts this long after the watch
// process, so the watch is already established when the list snapshot is
// taken: everything that changes after the snapshot then arrives as an event.
const RELIST_DELAY_MS = 1_000;
const RELIST_REQUEST_TIMEOUT = "--request-timeout=30s";
const WATCH_ONLY_FLAGS = new Set(["--watch", "--watch-only", "-w", "--output-watch-events"]);

export type WatchCallback = (data: string) => void;
export type ErrorCallback = (error: string) => void;

export type WatchLifecycleHooks = {
  /** The watcher stopped restarting: the stream is dead until started again. */
  onGiveUp?: (reason: string) => void;
  /**
   * Full list taken right after each watch (re)start. `kubectl get --watch-only`
   * starts at "now", so anything that changed while the previous run was down
   * (up to 8 s between restarts, and before the first run) would otherwise be
   * missing until the next change of that object.
   */
  onRelist?: (items: unknown[]) => void;
};

export function buildKubectlListArgs(watchArgs: string): string[] {
  const parts = watchArgs
    .trim()
    .split(/\s+/)
    .filter((part) => part && !WATCH_ONLY_FLAGS.has(part) && !part.startsWith("--request-timeout"));
  return [...parts, RELIST_REQUEST_TIMEOUT];
}

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
  private hooks: WatchLifecycleHooks = {};
  private generation = 0;
  private relistTimer: ReturnType<typeof setTimeout> | null = null;
  // Lines received while a relist is in flight; replayed over the list.
  private relistBuffer: string[] | null = null;

  async start(
    args: string,
    clusterId: string,
    onError: ErrorCallback,
    parser: EventParser,
    hooks: WatchLifecycleHooks = {},
  ): Promise<void> {
    this.stopped = false;
    this.args = args;
    this.clusterId = clusterId;
    this.parser = parser;
    this.onError = onError;
    this.hooks = hooks;
    await this.spawn();
  }

  private async kubeconfigPath() {
    const appLocalDataDirPath = await appDataDir();
    return `${appLocalDataDirPath}/${CONFIG_DIR}/${this.clusterId}.yaml`;
  }

  private scheduleRelist(generation: number) {
    if (!this.hooks.onRelist) return;
    this.clearRelist();
    this.relistBuffer = [];
    this.relistTimer = setTimeout(() => {
      this.relistTimer = null;
      void this.relist(generation);
    }, RELIST_DELAY_MS);
  }

  private clearRelist() {
    if (this.relistTimer) {
      clearTimeout(this.relistTimer);
      this.relistTimer = null;
    }
    this.relistBuffer = null;
  }

  private async relist(generation: number) {
    const onRelist = this.hooks.onRelist;
    if (!onRelist) return;
    try {
      const listArgs = [
        "--kubeconfig",
        await this.kubeconfigPath(),
        ...buildKubectlListArgs(this.args),
      ];
      const output = await Command.sidecar("binaries/rozoom-kubectl", listArgs).execute();
      if (generation !== this.generation || this.stopped) return;
      if (output.code !== 0)
        throw new Error(output.stderr.trim() || `kubectl exited ${output.code}`);
      const payload = JSON.parse(output.stdout) as { items?: unknown[] };
      onRelist(Array.isArray(payload.items) ? payload.items : []);
      const buffered = this.relistBuffer ?? [];
      this.relistBuffer = null;
      for (const line of buffered) dispatchClusterEvent(this.clusterId, line, this.parser);
    } catch (error) {
      if (generation !== this.generation) return;
      this.relistBuffer = null;
      this.onError(`relist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async spawn(): Promise<void> {
    const generation = ++this.generation;
    const splitArgs = [
      "--kubeconfig",
      await this.kubeconfigPath(),
      ...this.args.trim().split(/\s+/),
    ];

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
      if (generation !== this.generation) return;
      const event = dispatchClusterEvent(this.clusterId, line, this.parser);
      if (event) {
        this.relistBuffer?.push(line);
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
      this.scheduleRelist(generation);
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
      this.clearRelist();
      const reason = `watch stream exited ${WATCH_MAX_EMPTY_RESTARTS} times without a successful event; stopping restarts`;
      this.onError(reason);
      this.hooks.onGiveUp?.(reason);
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
    this.generation += 1;
    this.clearRelist();
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
