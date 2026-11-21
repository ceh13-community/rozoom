<script lang="ts">
  import { popOutPortForwardPreview, withRefreshNonce } from "$shared/lib/port-forward-preview";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { isTauriAvailable } from "$shared/lib/tauri-runtime";
  import {
    activePortForwards,
    startPortForward,
    stopPortForward,
    usedLocalPorts,
  } from "$shared/api/port-forward";
  import WorkbenchPanelSurface from "$shared/ui/workbench-panel-surface.svelte";
  import PortForwardBrowserTab from "./port-forward-browser-tab.svelte";
  import PortForwardDialog, { type PortForwardChoice } from "./port-forward-dialog.svelte";
  import {
    portForwardKey,
    portForwardResource,
    type PortForwardTarget,
  } from "./model/port-forward-target";

  // One port-forward flow for Services and Pods: the dialog picks the ports, then the panel
  // shows the forward with Copy URL, Open Web, Open external, Stop and Refresh.
  export type PortForwardPanelRequest = { token: number; target: PortForwardTarget } | null;

  interface Props {
    clusterId: string;
    request: PortForwardPanelRequest;
    onMessage: (message: string) => void;
    onError: (message: string) => void;
  }

  let { clusterId, request, onMessage, onError }: Props = $props();

  let pendingTarget = $state<PortForwardTarget | null>(null);
  let dialogOpen = $state(false);
  let dialogUsedPorts = $state<ReadonlySet<number>>(new Set());
  let currentKey = $state<string | null>(null);
  let currentUrl = $state("about:blank");
  let currentTitle = $state("Port-forward");
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

  function targetLabel(target: PortForwardTarget) {
    return `${target.namespace}/${target.name}`;
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
      onMessage("Stopped port-forward.");
      currentKey = null;
      closePanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to stop port-forward.";
      currentMessage = message;
      onError(message);
    } finally {
      currentStopping = false;
      currentLoading = false;
    }
  }

  function askForPorts(target: PortForwardTarget) {
    if (!isTauriAvailable()) {
      const message = "Port-forward is available only in the desktop app.";
      currentLoading = false;
      currentMessage = message;
      open = true;
      onError(message);
      return;
    }
    pendingTarget = target;
    dialogUsedPorts = usedLocalPorts();
    dialogOpen = true;
  }

  async function startForward(target: PortForwardTarget, choice: PortForwardChoice) {
    const { remotePort, localPort, scheme, openWeb } = choice;
    const uniqueKey = portForwardKey(clusterId, target, localPort, remotePort);
    const url = `${scheme}://127.0.0.1:${localPort}`;

    currentKey = uniqueKey;
    currentUrl = url;
    currentTitle = `Web ${target.name}`;
    currentMessage = "Starting port-forward...";
    currentLoading = true;
    currentStopping = false;
    open = true;

    const started = await startPortForward({
      namespace: target.namespace,
      resource: portForwardResource(target),
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
    onMessage(`Port-forward ready for ${targetLabel(target)}.`);
    if (openWeb) void popOutPortForwardPreview(url);
  }

  $effect(() => {
    if (!request || request.token === lastHandledToken) return;
    lastHandledToken = request.token;
    askForPorts(request.target);
  });

  $effect(() => {
    if (!currentForward) return;
    currentLoading = false;
    currentMessage = currentForward.lastMessage ?? currentMessage;
  });
</script>

<PortForwardDialog
  open={dialogOpen}
  target={pendingTarget}
  usedLocalPorts={dialogUsedPorts}
  onCancel={() => {
    dialogOpen = false;
    pendingTarget = null;
  }}
  onConfirm={(choice) => {
    const target = pendingTarget;
    dialogOpen = false;
    pendingTarget = null;
    if (target) void startForward(target, choice);
  }}
/>

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-[140] bg-black/20"
    aria-label="Close port-forward panel"
    onclick={closePanel}
  ></button>
  <aside
    class="fixed inset-y-0 right-0 z-[150] w-full border-l bg-background shadow-lg sm:max-w-[56rem]"
    data-testid="port-forward-panel"
  >
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
          onMessage("Copied the port-forward URL.");
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
        Running forwards are also listed in Network &gt; Port Forwarding.
      </WorkbenchPanelSurface>
    </div>
  </aside>
{/if}
