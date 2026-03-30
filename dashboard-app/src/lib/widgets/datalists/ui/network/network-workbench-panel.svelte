<script lang="ts">
  import { popOutPortForwardPreview, withRefreshNonce } from "$shared/lib/port-forward-preview";
  import { requestPortForwardStartMode } from "$shared/lib/port-forward-start-mode";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { isTauriAvailable } from "$shared/lib/tauri-runtime";
  import {
    activePortForwards,
    startPortForward,
    stopPortForward,
    type PortForwardProcess,
  } from "$shared/api/port-forward";
  import PortForwardBrowserTab from "../common/port-forward-browser-tab.svelte";
  import WorkbenchPanelSurface from "$shared/ui/workbench-panel-surface.svelte";
  import {
    getRandomLocalPort,
    requestLocalPort,
    resolveServicePortForwardTarget,
  } from "./model/service-port-forward";

  export type NetworkWorkbenchOpenRequest =
    | {
        token: number;
        kind: "service-port-forward";
        rowUid: string;
      }
    | null;

  interface Props {
    clusterId: string;
    rowsByUid: Map<string, Record<string, unknown>>;
    request: NetworkWorkbenchOpenRequest;
    onMessage: (message: string) => void;
    onError: (message: string) => void;
  }

  let { clusterId, rowsByUid, request, onMessage, onError }: Props = $props();

  let currentKey = $state<string | null>(null);
  let currentUrl = $state("about:blank");
  let currentTitle = $state("Service web preview");
  let currentMessage = $state<string | null>(null);
  let currentLoading = $state(false);
  let currentStopping = $state(false);
  let open = $state(false);
  let lastHandledToken = $state(0);

  const currentForward = $derived.by(() => {
    if (!currentKey) return null;
    return $activePortForwards[currentKey] ?? null;
  });

  function closePanel() {
    open = false;
  }

  function buildUrl(scheme: "http" | "https", localPort: number) {
    return `${scheme}://127.0.0.1:${localPort}`;
  }

  async function stopCurrentForward() {
    if (!currentKey) {
      closePanel();
      return;
    }
    if (currentStopping) return;
    const confirmed = await confirmAction("Stop this port-forward?", "Stop port-forward");
    if (!confirmed) return;
    currentStopping = true;
    currentLoading = true;
    currentMessage = "Stopping port-forward...";
    try {
      await stopPortForward(currentKey);
      currentMessage = "Port-forward stopped.";
      onMessage("Stopped service port-forward.");
      currentKey = null;
      closePanel();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop service port-forward.";
      currentMessage = message;
      onError(message);
    } finally {
      currentStopping = false;
      currentLoading = false;
    }
  }

  async function openServicePortForward(rowUid: string) {
    if (!isTauriAvailable()) {
      const message = "Service web tooling is available only in the desktop runtime.";
      currentLoading = false;
      currentMessage = message;
      open = true;
      onError(message);
      return;
    }
    const raw = rowsByUid.get(rowUid);
    if (!raw) return;
    const metadata = (raw.metadata ?? {}) as { name?: string; namespace?: string };
    const name = metadata.name ?? "unknown";
    const namespace = metadata.namespace ?? "default";
    const { remotePort, scheme } = resolveServicePortForwardTarget(raw);
    const startMode = requestPortForwardStartMode(remotePort);
    if (!startMode) return;

    const localPort = requestLocalPort(remotePort);
    if (!localPort) {
      onError("Invalid local port. Use integer 1-65535.");
      return;
    }

    const resource = `svc/${name}`;
    const uniqueKey = `${clusterId}:${namespace}:${resource}:${localPort}:${remotePort}`;
    const url = buildUrl(scheme, localPort);

    currentKey = uniqueKey;
    currentUrl = url;
    currentTitle = `Web ${name}`;
    currentMessage = "Starting port-forward...";
    currentLoading = true;
    currentStopping = false;
    open = true;

    const started = await startPortForward({
      namespace,
      resource,
      remotePort,
      localPort,
      clusterId,
      uniqueKey,
    });

    if (!started.success) {
      currentLoading = false;
      currentMessage = started.error ?? "Failed to start port-forward.";
      onError(currentMessage);
      return;
    }

    currentLoading = false;
    currentMessage = `Forwarding ${localPort}:${remotePort}`;
    onMessage(`Service web preview ready for ${namespace}/${name}.`);
    if (startMode === "start-and-open") {
      void popOutPortForwardPreview(url);
    }
  }

  $effect(() => {
    if (!request || request.token === lastHandledToken) return;
    lastHandledToken = request.token;
    if (request.kind === "service-port-forward") {
      void openServicePortForward(request.rowUid);
    }
  });

  $effect(() => {
    if (!currentForward) return;
    currentLoading = false;
    currentMessage = currentForward.lastMessage ?? currentMessage;
  });
</script>

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-[140] bg-black/20"
    aria-label="Close network workbench"
    onclick={closePanel}
  ></button>
  <aside class="fixed inset-y-0 right-0 z-[150] w-full border-l bg-background shadow-lg sm:max-w-[56rem]">
    <div class="flex h-full min-h-0 flex-col">
      <PortForwardBrowserTab
        title={currentTitle}
        url={currentUrl}
        loading={currentLoading}
        message={currentForward?.lastError ?? currentMessage}
        onRefresh={() => {
          currentUrl = withRefreshNonce(currentUrl);
        }}
        onCopyUrl={() => {
          if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
          void navigator.clipboard.writeText(currentUrl);
          onMessage("Copied service preview URL.");
        }}
        onOpenPreview={() => {
          void popOutPortForwardPreview(currentUrl);
        }}
        onOpenExternal={() => {
          void popOutPortForwardPreview(currentUrl);
        }}
        onStop={() => {
          void stopCurrentForward();
        }}
        stopBusy={currentStopping}
        stopLabel="Stopping..."
      />
      <WorkbenchPanelSurface>
        Service-oriented web tooling runs in this separate boundary so the base network table stays cheap.
      </WorkbenchPanelSurface>
    </div>
  </aside>
{/if}
