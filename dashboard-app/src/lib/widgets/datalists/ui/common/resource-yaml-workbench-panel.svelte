<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import Copy from "@lucide/svelte/icons/copy";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import DetailsSheetHeader from "./details-sheet-header.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { Button } from "$shared/ui/button";
  import WorkbenchPanelSurface from "$shared/ui/workbench-panel-surface.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  export type ResourceYamlWorkbenchRequest =
    | {
        token: number;
        kind: "yaml";
        name: string;
        namespace?: string;
        resource: string;
        namespaceScoped: boolean;
        /** Panel header title, e.g. "Storage YAML" */
        title?: string;
        /** Toast on copy, e.g. "Copied storage YAML." */
        copyLabel?: string;
        /** Toast on load success */
        loadedLabel?: string;
        /** Toast on load error */
        errorLabel?: string;
      }
    | null;

  interface Props {
    clusterId: string;
    request: ResourceYamlWorkbenchRequest;
    onMessage: (message: string) => void;
    onError: (message: string) => void;
  }

  let { clusterId, request, onMessage, onError }: Props = $props();

  let open = $state(false);
  let loading = $state(false);
  let yamlText = $state("");
  let activeRequest = $state<ResourceYamlWorkbenchRequest>(null);
  let lastHandledToken = $state(0);

  function closePanel() {
    open = false;
  }

  async function copyYaml() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(yamlText);
    onMessage(activeRequest?.copyLabel ?? "Copied YAML.");
  }

  async function loadYaml(nextRequest: Exclude<ResourceYamlWorkbenchRequest, null>) {
    if (!clusterId) return;
    loading = true;
    activeRequest = nextRequest;
    open = true;
    try {
      const args = ["get", nextRequest.resource, nextRequest.name];
      if (nextRequest.namespaceScoped && nextRequest.namespace) {
        args.push("-n", nextRequest.namespace);
      }
      args.push("-o", "yaml");
      const response = await kubectlRawArgsFront(args, { clusterId });
      if (response.errors) {
        throw new Error(response.errors);
      }
      yamlText = response.output ?? "";
      onMessage(nextRequest.loadedLabel ?? `Loaded YAML for ${nextRequest.name}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : (nextRequest.errorLabel ?? "Failed to load YAML."));
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!request || request.token === lastHandledToken) return;
    lastHandledToken = request.token;
    void loadYaml(request);
  });
</script>

{#if open && activeRequest}
  <DetailsSheetPortal {open} onClose={closePanel} closeAriaLabel="Close YAML workbench" maxWidthClass="sm:max-w-[56rem]">
    <DetailsSheetHeader
      title={activeRequest.title ?? "YAML"}
      name={activeRequest.name}
      icon={FileText}
      onClose={closePanel}
      closeAriaLabel="Close YAML"
    />

    <div class="flex items-center gap-2 border-b px-4 py-3">
      <Button
        variant="outline"
        size="sm"
        onclick={() => {
          if (!activeRequest) return;
          void loadYaml(activeRequest);
        }}
        disabled={loading}
      >
        <RefreshCw class={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
      <Button variant="outline" size="sm" onclick={() => void copyYaml()} disabled={!yamlText}>
        <Copy class="mr-2 h-4 w-4" />
        Copy YAML
      </Button>
    </div>

    <WorkbenchPanelSurface tone="code">
      {#if loading}
        <div class="text-slate-400">Loading YAML<LoadingDots /></div>
      {:else if !yamlText}
        <div class="text-slate-400">No YAML loaded.</div>
      {:else}
        <pre class="whitespace-pre-wrap break-words">{yamlText}</pre>
      {/if}
    </WorkbenchPanelSurface>
  </DetailsSheetPortal>
{/if}
