<script lang="ts">
  import { onMount, onDestroy, afterUpdate, tick } from "svelte";
  import { Button } from "$shared/ui/button";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { execCliForCluster, execShellCommand, type CliTool } from "$shared/api/cli";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { buildTextExportFilename, exportTextArtifact } from "$shared/lib/text-export";
  import { closeShellModal, focusShellModal, type ShellWindowState } from "$features/shell";
  import type { PodItem } from "$shared/model/clusters";
  import {
    buildPodShellExecArgs,
    buildPodAttachArgs,
    getPodSessionInitialCommand,
    pickMainContainer,
  } from "$widgets/datalists/ui/pods-list/pod-shell";
  import { tokenizeCommand } from "$widgets/shell/lib/tokenize-command";

  export let windowState: ShellWindowState;
  export let windowIndex = 0;

  let shellBusy = false;
  let shellReady = false;
  let shellCommandBusy = false;
  let shellOutput: string[] = [];
  let shellCommand = "kubectl get pods -A";
  let shellError: string | null = null;
  let shellLogContainer: HTMLDivElement | null = null;
  let needsScrollToBottom = false;
  let shellPanel: HTMLDivElement | null = null;
  let shellMode: "debug" | "pod-exec" | "pod-attach" = "debug";
  let shellSessionKind: "debug-shell" | "debug-describe" | "pod-debug" = "debug-shell";
  let shellTargetNamespace = "default";
  let shellTargetLabel = "";
  let shellTargetPod: Partial<PodItem> | null = null;
  let shellPresetCommand = "";
  let shellOpenedAt: number | null = null;
  let shellLastRunAt: number | null = null;
  let shellCleanupPod: { name: string; namespace: string } | null = null;
  let sessionClusterId = "";
  let collapsed = false;
  let commandHistory: string[] = loadShellHistory();
  let historyCursor = -1;
  let draftCommand = "";
  let pointerId: number | null = null;
  let resizePointerId: number | null = null;
  let dragStart = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, width: 0, height: 0 };
  let position = { x: 80, y: 80 };
  let expandedWidth = 640;
  let expandedHeight = 420;
  let maximized = false;
  let restoreBounds: { x: number; y: number; width: number; height: number } | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let activeSessionId = 0;
  const MAX_COMMAND_HISTORY = 200;
  const SHELL_HISTORY_KEY = "dashboard.shell.command-history.v1";
  const SHELL_WINDOW_STATE_KEY = "dashboard.shell.window-state.by-cluster.v1";

  function loadShellHistory(): string[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(SHELL_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-MAX_COMMAND_HISTORY) : [];
    } catch {
      return [];
    }
  }

  function saveShellHistory(history: string[]) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SHELL_HISTORY_KEY,
        JSON.stringify(history.slice(-MAX_COMMAND_HISTORY)),
      );
    } catch {
      /* quota exceeded - ignore */
    }
  }

  const COLLAPSED_HEIGHT = 72;
  const COLLAPSED_WIDTH = 360;

  let shellStatus = getShellStatusMeta(shellReady, shellBusy, shellMode);
  $: shellStatus = getShellStatusMeta(shellReady, shellBusy, shellMode);
  let podDebugCleanupHandled = false;

  afterUpdate(() => {
    if (shellPanel) {
      observePanelSize();
    }
    if (!needsScrollToBottom || collapsed) return;
    tick().then(() => {
      if (!shellLogContainer) return;
      shellLogContainer.scrollTop = shellLogContainer.scrollHeight;
      needsScrollToBottom = false;
    });
  });

  onMount(() => {
    void startSession(windowState);
    if (typeof window !== "undefined") {
      position = {
        x: Math.max(0, position.x || window.innerWidth * 0.08 + windowIndex * 24),
        y: Math.max(0, position.y || window.innerHeight * 0.08 + windowIndex * 24),
      };
      if (maximized) {
        handleWindowResize();
      }
      window.addEventListener("pointerup", handleGlobalPointerUp);
      window.addEventListener("resize", handleWindowResize);
    }
    observePanelSize();
    return () => {
      stopDragging();
      stopResizing();
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver?.disconnect();
    };
  });

  onDestroy(() => {
    if (
      !podDebugCleanupHandled &&
      shellSessionKind === "pod-debug" &&
      shellCleanupPod &&
      sessionClusterId
    ) {
      void deletePodDebugCleanup(shellCleanupPod, sessionClusterId).catch(() => undefined);
    }
    stopDragging();
    stopResizing();
    if (typeof window !== "undefined") {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("resize", handleWindowResize);
    }
    resizeObserver?.disconnect();
  });

  function observePanelSize() {
    if (typeof ResizeObserver === "undefined" || !shellPanel) return;
    resizeObserver ??= new ResizeObserver(() => {
      if (!shellPanel || collapsed) return;
      expandedWidth = shellPanel.offsetWidth;
      expandedHeight = shellPanel.offsetHeight;
    });
    resizeObserver.observe(shellPanel);
  }

  function syncPanelSizeFromDom() {
    if (!shellPanel || collapsed) return;
    const rect = shellPanel.getBoundingClientRect();
    expandedWidth = Math.round(rect.width);
    expandedHeight = Math.round(rect.height);
  }

  function handleGlobalPointerUp() {
    syncPanelSizeFromDom();
    persistWindowState();
    stopResizing();
  }

  function handleWindowResize() {
    if (!maximized || typeof window === "undefined") return;
    position = { x: 8, y: 8 };
    expandedWidth = Math.max(320, window.innerWidth - 16);
    expandedHeight = Math.max(220, window.innerHeight - 16);
    persistWindowState();
  }

  function getShellStatusMeta(
    ready: boolean,
    busy: boolean,
    mode: "debug" | "pod-exec" | "pod-attach",
  ) {
    const modeLabel = mode === "debug" ? "debug" : mode === "pod-attach" ? "attach" : "pod";
    if (ready) {
      return {
        label: `ready (${modeLabel})`,
        dotClass: "bg-emerald-400",
        pulse: false,
      };
    }
    if (busy) {
      return {
        label: `starting... (${modeLabel})`,
        dotClass: "bg-amber-300",
        pulse: true,
      };
    }
    return {
      label: `initializing... (${modeLabel})`,
      dotClass: "bg-slate-400",
      pulse: true,
    };
  }

  type PersistedWindowState = {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };

  function getWindowStateClusterId() {
    return sessionClusterId || windowState.clusterId || "";
  }

  function readWindowStateMap() {
    if (typeof window === "undefined") return {} as Record<string, PersistedWindowState>;
    try {
      const raw = window.localStorage.getItem(SHELL_WINDOW_STATE_KEY);
      if (!raw) return {} as Record<string, PersistedWindowState>;
      return JSON.parse(raw) as Record<string, PersistedWindowState>;
    } catch {
      return {} as Record<string, PersistedWindowState>;
    }
  }

  function persistWindowState() {
    if (typeof window === "undefined") return;
    const clusterId = getWindowStateClusterId();
    if (!clusterId) return;
    if (collapsed) return;
    const map = readWindowStateMap();
    map[clusterId] = {
      x: position.x,
      y: position.y,
      width: expandedWidth,
      height: expandedHeight,
      maximized,
    };
    try {
      window.localStorage.setItem(SHELL_WINDOW_STATE_KEY, JSON.stringify(map));
    } catch {
      // ignore localStorage failures
    }
  }

  function restoreWindowState(clusterId: string) {
    if (typeof window === "undefined" || !clusterId) return false;
    const map = readWindowStateMap();
    const parsed = map[clusterId];
    if (!parsed) return false;
    if (typeof parsed.x === "number") position.x = parsed.x;
    if (typeof parsed.y === "number") position.y = parsed.y;
    if (typeof parsed.width === "number" && parsed.width > 0) expandedWidth = parsed.width;
    if (typeof parsed.height === "number" && parsed.height > 0) expandedHeight = parsed.height;
    if (typeof parsed.maximized === "boolean") maximized = parsed.maximized;
    if (maximized) {
      handleWindowResize();
    }
    return true;
  }

  function resetSession() {
    shellBusy = false;
    shellReady = false;
    shellCommandBusy = false;
    shellOutput = [];
    shellError = null;
    shellTargetPod = null;
    shellTargetNamespace = "default";
    shellTargetLabel = "";
    shellPresetCommand = "";
    shellOpenedAt = null;
    shellLastRunAt = null;
    shellCleanupPod = null;
    sessionClusterId = "";
    shellCommand = "kubectl get pods -A";
    shellMode = "debug";
    shellSessionKind = "debug-shell";
    podDebugCleanupHandled = false;
    collapsed = false;
    historyCursor = -1;
    draftCommand = "";
    maximized = false;
    restoreBounds = null;
  }

  function resetHistoryNavigation() {
    historyCursor = -1;
    draftCommand = "";
  }

  function pushCommandToHistory(command: string) {
    const normalized = command.trim();
    if (!normalized) return;
    const last = commandHistory[commandHistory.length - 1];
    if (last === normalized) {
      resetHistoryNavigation();
      return;
    }
    commandHistory = [...commandHistory, normalized].slice(-MAX_COMMAND_HISTORY);
    saveShellHistory(commandHistory);
    resetHistoryNavigation();
  }

  function navigateHistory(direction: -1 | 1) {
    if (commandHistory.length === 0) return;

    if (direction < 0) {
      if (historyCursor === -1) {
        draftCommand = shellCommand;
        historyCursor = commandHistory.length - 1;
      } else if (historyCursor > 0) {
        historyCursor -= 1;
      }
      shellCommand = commandHistory[historyCursor] ?? shellCommand;
      return;
    }

    if (historyCursor === -1) return;
    if (historyCursor < commandHistory.length - 1) {
      historyCursor += 1;
      shellCommand = commandHistory[historyCursor] ?? shellCommand;
      return;
    }
    historyCursor = -1;
    shellCommand = draftCommand;
  }

  function handleCommandInput() {
    if (historyCursor !== -1) {
      historyCursor = -1;
      draftCommand = shellCommand;
    }
  }

  function isCaretAtFirstLine(target: HTMLTextAreaElement | null): boolean {
    if (!target) return true;
    const { selectionStart, value } = target;
    const before = value.slice(0, selectionStart);
    return !before.includes("\n");
  }

  function isCaretAtLastLine(target: HTMLTextAreaElement | null): boolean {
    if (!target) return true;
    const { selectionStart, value } = target;
    const after = value.slice(selectionStart);
    return !after.includes("\n");
  }

  function handleCommandKeydown(event: KeyboardEvent) {
    // Submit:
    //   Enter (no modifier) on a single-line command  →  submit
    //   Ctrl/Cmd/Meta + Enter at any time              →  submit
    //   Shift + Enter or Alt + Enter                   →  newline
    // Rationale: preserves the familiar Enter-to-run flow for simple
    // commands, but allows multi-line paste and shift-enter composition.
    const target = event.currentTarget as HTMLTextAreaElement | null;
    if (event.key === "Enter") {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        void executeShellCommand();
        return;
      }
      if (event.shiftKey || event.altKey) {
        // Let the textarea insert the newline naturally.
        return;
      }
      // Plain Enter: only submit when the command is a single line.
      if (!shellCommand.includes("\n")) {
        event.preventDefault();
        void executeShellCommand();
      }
      return;
    }
    // History navigation only when the caret is at the very top/bottom,
    // so multi-line editing with arrow keys still works normally.
    if (event.key === "ArrowUp" && isCaretAtFirstLine(target)) {
      event.preventDefault();
      navigateHistory(-1);
      return;
    }
    if (event.key === "ArrowDown" && isCaretAtLastLine(target)) {
      event.preventDefault();
      navigateHistory(1);
    }
  }

  function appendShellOutput(text: string) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    shellOutput = [...shellOutput, ...lines];
    needsScrollToBottom = true;
  }

  function isDebugDescribeSession() {
    return shellMode === "debug" && shellSessionKind === "debug-describe";
  }

  function formatSessionTime(value: number | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  async function copyToClipboard(text: string, successLabel: string) {
    if (!text.trim()) return;
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      shellError = "Clipboard API is unavailable in this environment.";
      return;
    }
    await navigator.clipboard.writeText(text);
    appendShellOutput(`ℹ️ ${successLabel}`);
  }

  async function exportSessionArtifact(text: string, label: string) {
    if (!text.trim()) return;
    const filename = buildTextExportFilename(
      "support",
      [sessionClusterId || "cluster", shellSessionKind, shellTargetLabel || "shell-output"],
      "txt",
    );
    const result = await exportTextArtifact({ filename, text });
    appendShellOutput(`ℹ️ ${label} exported to ${result.pathHint}`);
  }

  function normalizeShellError(message: string) {
    return message
      .replace(/^\[ERROR\] \[[^\]]+\]:\s*/g, "")
      .replace(/\s*command terminated with exit code \d+\s*$/g, "")
      .trim();
  }

  function isAlreadyExistsError(message: string) {
    return /already exists/i.test(message);
  }

  function isSessionActive(sessionId: number) {
    return sessionId === activeSessionId;
  }

  async function startSession(state: ShellWindowState) {
    const clusterId = state.clusterId;
    const targetPod = state.targetPod;
    const sessionId = ++activeSessionId;
    shellBusy = true;
    shellReady = false;
    shellCommandBusy = false;
    shellError = null;
    shellOutput = [];
    shellTargetPod = targetPod;
    shellMode = targetPod
      ? state.podSessionMode === "attach"
        ? "pod-attach"
        : "pod-exec"
      : "debug";
    shellSessionKind = state.sessionKind ?? "debug-shell";
    shellTargetNamespace = targetPod?.metadata?.namespace ?? state.targetNamespace ?? "default";
    shellTargetLabel = state.sessionLabel ?? targetPod?.metadata?.name ?? clusterId;
    shellPresetCommand = state.initialCommand?.trim() ?? "";
    shellOpenedAt = state.openedAt ?? Date.now();
    shellLastRunAt = null;
    shellCleanupPod = state.cleanupPod ?? null;
    sessionClusterId = clusterId;
    shellCommand = state.initialCommand
      ? state.initialCommand
      : getPodSessionInitialCommand(shellMode);
    resetHistoryNavigation();
    collapsed = false;
    maximized = false;
    restoreBounds = null;
    restoreWindowState(clusterId);
    if (windowIndex > 0 && !maximized) {
      position = {
        x: Math.max(0, position.x + windowIndex * 24),
        y: Math.max(0, position.y + windowIndex * 24),
      };
    }
    appendShellOutput(
      `Preparing ${
        shellMode === "debug" ? "terminal" : shellMode === "pod-attach" ? "pod attach" : "pod shell"
      } for ${shellMode === "debug" ? shellTargetLabel : `${shellTargetNamespace}/${shellTargetLabel}`}...`,
    );

    try {
      if (shellMode === "debug") {
        shellReady = true;
        const tools = Object.keys(SUPPORTED_CLI_TOOLS).join(", ");
        appendShellOutput(`\n✅ Terminal ready. K8s tools: ${tools}`);
        appendShellOutput(`Shell commands also available (ls, cat, grep, find, curl, etc.)`);
        if (!isSessionActive(sessionId)) return;
        if (shellPresetCommand) {
          await executePresetCommand(shellPresetCommand);
        }
      } else if (shellMode === "pod-attach" || shellMode === "pod-exec") {
        // Pre-check: verify pod is running
        const podPhase = shellTargetPod?.status as { phase?: string } | undefined;
        const phase = (podPhase?.phase || "").toLowerCase();
        if (phase && phase !== "running") {
          throw new Error(
            `Pod is not running (phase: ${podPhase?.phase}). Cannot open ${shellMode === "pod-attach" ? "attach" : "shell"} session.`,
          );
        }
        shellReady = true;
        const mainContainer = shellTargetPod ? pickMainContainer(shellTargetPod) : undefined;
        const containerInfo = mainContainer ? ` (container: ${mainContainer})` : "";
        appendShellOutput(
          `\n✅ ${shellMode === "pod-attach" ? "Attached" : "Connected"} to ${shellTargetNamespace}/${shellTargetLabel}${containerInfo}`,
        );
      }
    } catch (error) {
      if (!isSessionActive(sessionId)) return;
      shellError = error instanceof Error ? error.message : "Failed to initialize shell.";
      appendShellOutput(`\n❌ ${shellError}`);
    } finally {
      if (isSessionActive(sessionId)) {
        shellBusy = false;
      }
    }
  }

  const SUPPORTED_CLI_TOOLS: Record<string, CliTool> = {
    kubectl: "kubectl",
    helm: "helm",
    stern: "stern",
    velero: "velero",
    kustomize: "kustomize",
    kubeconform: "kubeconform",
    pluto: "pluto",
    yq: "yq",
    doctl: "doctl",
    aws: "aws",
    gcloud: "gcloud",
    hcloud: "hcloud",
    oc: "oc",
    az: "az",
    curl: "curl",
    doggo: "doggo",
    grpcurl: "grpcurl",
    websocat: "websocat",
    tcping: "tcping",
    trivy: "trivy",
  };

  function parseCliCommand(command: string): { tool: CliTool; args: string[] } | null {
    const result = tokenizeCommand(command);
    if (!result.ok || result.tokens.length === 0) return null;
    const [head, ...rest] = result.tokens;
    const tool = SUPPORTED_CLI_TOOLS[head];
    if (!tool) return null;
    return { tool, args: rest };
  }

  async function runLocalCommand(command: string) {
    const parsed = parseCliCommand(command);
    const result = parsed
      ? await execCliForCluster(parsed.tool, parsed.args, sessionClusterId)
      : await execShellCommand(command);
    const output = result.stdout?.trim();
    if (output?.length) appendShellOutput(output);
    if (result.code !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(stderr || `Command exited with code ${result.code}`);
    }
  }

  async function runDebugCommand(command: string) {
    if (shellMode === "debug") {
      return runLocalCommand(command);
    }

    if (shellMode === "pod-attach") {
      // kubectl attach connects to the main process stdin/stdout/stderr
      const args = buildPodAttachArgs(shellTargetPod!);
      const result = await kubectlRawArgsFront(args, {
        clusterId: sessionClusterId,
      });

      if (!result.errors && result.code === 0) {
        const output = result.output?.trim();
        if (output?.length) {
          appendShellOutput(output);
        }
        return;
      }

      throw new Error(normalizeShellError(result.errors || `Attach failed`));
    }

    // pod-exec: run command inside a new shell in the container
    const args = buildPodShellExecArgs(shellTargetPod!, command);
    const result = await kubectlRawArgsFront(args, {
      clusterId: sessionClusterId,
    });

    if (!result.errors && result.code === 0) {
      const output = result.output?.trim();
      if (output?.length) {
        appendShellOutput(output);
      }
      return;
    }

    throw new Error(normalizeShellError(result.errors || `Command failed: ${command}`));
  }

  async function executeShellCommand() {
    if (!shellReady || shellBusy || shellCommandBusy) return;
    const command = shellCommand.trim();
    if (!command) return;
    pushCommandToHistory(command);
    shellCommand = "";
    shellCommandBusy = true;
    appendShellOutput("");
    appendShellOutput(`$ ${command}`);

    try {
      await runDebugCommand(command);
    } catch (error) {
      shellError = error instanceof Error ? error.message : "Failed to execute command.";
      appendShellOutput(`❌ ${shellError}`);
    } finally {
      shellCommandBusy = false;
    }
  }

  async function executePresetCommand(command: string) {
    const normalized = command.trim();
    if (!normalized) return;
    shellCommandBusy = true;
    shellLastRunAt = Date.now();
    shellError = null;
    appendShellOutput("");
    appendShellOutput(`$ ${normalized}`);
    try {
      await runDebugCommand(normalized);
    } catch (error) {
      shellError = error instanceof Error ? error.message : "Failed to execute command.";
      appendShellOutput(`❌ ${shellError}`);
    } finally {
      shellCommandBusy = false;
    }
  }

  async function deletePodDebugCleanup(
    cleanupPod: { name: string; namespace: string },
    clusterId: string,
  ) {
    await kubectlRawArgsFront(
      [
        "delete",
        "pod",
        cleanupPod.name,
        "--namespace",
        cleanupPod.namespace,
        "--ignore-not-found=true",
        "--grace-period=0",
        "--force",
      ],
      {
        clusterId,
      },
    );
    podDebugCleanupHandled = true;
  }

  async function handleClose() {
    if (shellBusy) return;
    if (shellMode === "debug") {
      closeShellModal(windowState.id);
      return;
    }
    if (shellSessionKind === "pod-debug" && shellCleanupPod) {
      const confirmed = await confirmAction(
        `Close debug session and delete ${shellCleanupPod.namespace}/${shellCleanupPod.name}?`,
        "Confirm close",
      );
      if (!confirmed) return;
      shellBusy = true;
      try {
        await deletePodDebugCleanup(shellCleanupPod, sessionClusterId);
        closeShellModal(windowState.id);
      } catch (error) {
        shellError = error instanceof Error ? error.message : "Failed to delete debug pod.";
        appendShellOutput(`❌ ${shellError}`);
      } finally {
        shellBusy = false;
      }
      return;
    }
    const podConfirmed = await confirmAction(
      `Close ${shellMode === "pod-attach" ? "pod attach" : "pod shell"} for ${shellTargetNamespace}/${shellTargetLabel}?`,
      "Confirm close",
    );
    if (!podConfirmed) return;
    closeShellModal(windowState.id);
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const element = event.target as HTMLElement;
    if (element.closest("button")) return;
    if (typeof window === "undefined") return;
    if (maximized) return;
    syncPanelSizeFromDom();
    pointerId = event.pointerId;
    dragStart = { x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    event.preventDefault();
  }

  function handleWindowPointerDown() {
    focusShellModal(windowState.id);
  }

  function handlePointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId || typeof window === "undefined")
      return;
    if (maximized) return;
    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    dragStart = { x: event.clientX, y: event.clientY };
    const targetWidth = collapsed ? COLLAPSED_WIDTH : expandedWidth;
    const targetHeight = collapsed ? COLLAPSED_HEIGHT : expandedHeight;
    const maxX = Math.max(0, window.innerWidth - targetWidth - 16);
    const maxY = Math.max(0, window.innerHeight - targetHeight - 16);
    position = {
      x: Math.min(Math.max(0, position.x + deltaX), maxX),
      y: Math.min(Math.max(0, position.y + deltaY), maxY),
    };
  }

  function handlePointerUp() {
    stopDragging();
  }

  function stopDragging() {
    if (pointerId === null || typeof window === "undefined") return;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    pointerId = null;
  }

  function handleResizePointerDown(event: PointerEvent) {
    if (event.button !== 0 || typeof window === "undefined") return;
    if (collapsed || maximized) return;
    event.stopPropagation();
    event.preventDefault();
    syncPanelSizeFromDom();
    resizePointerId = event.pointerId;
    resizeStart = {
      x: event.clientX,
      y: event.clientY,
      width: expandedWidth,
      height: expandedHeight,
    };
    window.addEventListener("pointermove", handleResizePointerMove);
    window.addEventListener("pointerup", handleResizePointerUp);
    window.addEventListener("pointercancel", handleResizePointerUp);
  }

  function handleResizePointerMove(event: PointerEvent) {
    if (
      resizePointerId === null ||
      event.pointerId !== resizePointerId ||
      typeof window === "undefined"
    )
      return;
    const deltaX = event.clientX - resizeStart.x;
    const deltaY = event.clientY - resizeStart.y;
    const maxWidth = Math.max(220, window.innerWidth - position.x - 16);
    const maxHeight = Math.max(140, window.innerHeight - position.y - 16);
    expandedWidth = Math.min(maxWidth, Math.max(220, resizeStart.width + deltaX));
    expandedHeight = Math.min(maxHeight, Math.max(140, resizeStart.height + deltaY));
  }

  function handleResizePointerUp() {
    syncPanelSizeFromDom();
    persistWindowState();
    stopResizing();
  }

  function stopResizing() {
    if (resizePointerId === null || typeof window === "undefined") return;
    window.removeEventListener("pointermove", handleResizePointerMove);
    window.removeEventListener("pointerup", handleResizePointerUp);
    window.removeEventListener("pointercancel", handleResizePointerUp);
    resizePointerId = null;
  }

  function toggleCollapse() {
    if (maximized) return;
    if (collapsed) {
      collapsed = false;
      observePanelSize();
      persistWindowState();
    } else {
      collapsed = true;
    }
  }

  function toggleMaximize() {
    if (typeof window === "undefined") return;
    if (!maximized) {
      syncPanelSizeFromDom();
      restoreBounds = {
        x: position.x,
        y: position.y,
        width: expandedWidth,
        height: expandedHeight,
      };
      collapsed = false;
      maximized = true;
      position = { x: 8, y: 8 };
      expandedWidth = Math.max(320, window.innerWidth - 16);
      expandedHeight = Math.max(220, window.innerHeight - 16);
      persistWindowState();
      return;
    }

    maximized = false;
    if (restoreBounds) {
      position = { x: restoreBounds.x, y: restoreBounds.y };
      expandedWidth = restoreBounds.width;
      expandedHeight = restoreBounds.height;
    }
    persistWindowState();
  }
</script>

<div
  class="fixed z-[180] pointer-events-auto flex flex-col rounded-2xl border border-slate-800 bg-slate-950/90 shadow-2xl backdrop-blur-lg"
  bind:this={shellPanel}
  on:pointerdown={handleWindowPointerDown}
  style={`top:${position.y}px; left:${position.x}px; width:${collapsed ? COLLAPSED_WIDTH : expandedWidth}px; height:${collapsed ? COLLAPSED_HEIGHT : expandedHeight}px; resize:none; overflow: hidden;`}
>
  <header
    class="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 text-sm text-white cursor-grab select-none"
    on:pointerdown={handlePointerDown}
  >
    <div>
      <div class="text-base font-semibold">
        {shellMode === "debug"
          ? "Terminal"
          : shellSessionKind === "pod-debug"
            ? "Pod debug session"
            : shellMode === "pod-attach"
              ? "Pod attach"
              : "Pod shell"}
      </div>
      <div class="text-xs text-muted-foreground">
        {shellTargetLabel} (namespace: {shellTargetNamespace})
        <span class="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide">
          <span
            class={`h-2 w-2 rounded-full ${shellStatus.dotClass} ${shellStatus.pulse ? "animate-pulse" : ""}`}
            aria-hidden="true"
          ></span>
          {shellStatus.label}
        </span>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={collapsed ? "Expand shell" : "Minimize shell"}
        onclick={toggleCollapse}
      >
        {collapsed ? "▢" : "-"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={maximized ? "Restore shell size" : "Maximize shell"}
        onclick={toggleMaximize}
      >
        {maximized ? "❐" : "□"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close Shell"
        disabled={shellBusy}
        onclick={handleClose}
      >
        ✕
      </Button>
    </div>
  </header>

  {#if collapsed}
    <div class="px-4 py-2 text-xs text-muted-foreground">
      {isDebugDescribeSession()
        ? "Describe minimized. Expand to inspect output."
        : "Terminal minimized. Expand to continue."}
    </div>
  {:else}
    {#if isDebugDescribeSession()}
      <div class="border-b border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
        <div class="grid gap-1 sm:grid-cols-2">
          <div>
            <span class="text-slate-500">Cluster:</span>
            {sessionClusterId || windowState.clusterId}
          </div>
          <div>
            <span class="text-slate-500">Namespace:</span>
            {shellTargetNamespace}
          </div>
          <div>
            <span class="text-slate-500">Opened:</span>
            {formatSessionTime(shellOpenedAt)}
          </div>
          <div>
            <span class="text-slate-500">Last run:</span>
            {formatSessionTime(shellLastRunAt ?? shellOpenedAt)}
          </div>
        </div>
        <div
          class="mt-2 break-all rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[11px] text-emerald-300"
        >
          {shellPresetCommand || shellCommand}
        </div>
      </div>
    {/if}
    <div
      class="min-h-0 flex-1 overflow-auto bg-slate-950 px-4 py-3 font-mono text-xs leading-tight text-emerald-300"
      bind:this={shellLogContainer}
    >
      {#if shellOutput.length === 0}
        <div>Preparing shell...</div>
      {:else}
        {#each shellOutput as line}
          <div class="whitespace-pre-wrap">{line || " "}</div>
        {/each}
      {/if}
    </div>
    <div class="border-t border-slate-800 px-4 py-3">
      {#if isDebugDescribeSession()}
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            class="whitespace-nowrap"
            disabled={!shellReady || shellBusy || shellCommandBusy || !shellPresetCommand}
            onclick={() => void executePresetCommand(shellPresetCommand)}
          >
            {shellCommandBusy ? "Running" : "Rerun"}
          </Button>
          <Button
            variant="outline"
            class="whitespace-nowrap"
            disabled={!shellPresetCommand}
            onclick={() =>
              void copyToClipboard(shellPresetCommand, "Copied debug describe command.")}
          >
            Copy command
          </Button>
          <Button
            variant="outline"
            class="whitespace-nowrap"
            disabled={shellOutput.length === 0}
            onclick={() =>
              void copyToClipboard(shellOutput.join("\n"), "Copied debug describe output.")}
          >
            Copy output
          </Button>
          <Button
            variant="outline"
            class="whitespace-nowrap"
            disabled={shellOutput.length === 0}
            onclick={() =>
              void exportSessionArtifact(shellOutput.join("\n"), "Debug describe output")}
          >
            Export output
          </Button>
        </div>
      {:else}
        <div class="flex flex-wrap items-start gap-2">
          <div class="flex-1 min-w-0">
            <textarea
              class="w-full resize-none rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-[13px] font-mono text-slate-100 outline-none transition focus:border-slate-500"
              placeholder={shellMode === "pod-exec" || shellMode === "pod-attach"
                ? "Run command inside the selected pod  (Enter = run, Shift+Enter = newline, Ctrl+Enter = run multi-line)"
                : "Type command (for example: kubectl get ns)\nMulti-line paste OK. Enter = run, Shift+Enter = newline, Ctrl+Enter = run multi-line."}
              bind:value={shellCommand}
              rows={Math.min(Math.max(2, shellCommand.split("\n").length), 12)}
              disabled={!shellReady || shellBusy || shellCommandBusy}
              on:input={handleCommandInput}
              on:keydown={handleCommandKeydown}
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
            ></textarea>
          </div>
          <Button
            variant="outline"
            class="whitespace-nowrap shrink-0"
            disabled={!shellReady || shellBusy || shellCommandBusy || !shellCommand.trim()}
            onclick={executeShellCommand}
          >
            {shellCommandBusy ? "Running" : "Run"}
          </Button>
        </div>
      {/if}
      {#if shellError}
        <div
          class="mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {shellError}
        </div>
      {/if}
    </div>
    {#if !collapsed && !maximized}
      <button
        type="button"
        class="absolute -bottom-2 -right-2 z-20 h-10 w-10 cursor-nwse-resize"
        aria-label="Resize shell window"
        on:pointerdown={handleResizePointerDown}
      >
        <span
          class="pointer-events-none absolute bottom-2 right-2 h-5 w-5 border-l border-t border-slate-700/70 bg-slate-900/70"
          aria-hidden="true"
        ></span>
      </button>
    {/if}
  {/if}
</div>
