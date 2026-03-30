<script lang="ts">
  import { tick } from "svelte";
  import type { PageData } from "$entities/cluster";
  import { trackWorkloadEvent } from "$features/workloads-management";
  import { ErrorMessage } from "$shared/ui/error-message";
  import {
    createWorkloadProps,
    workloadComponentLoaders,
  } from "../model/workload-route-registry";
  import {
    isRecoverableWorkloadImportError,
    resolveWorkloadComponentExport,
    shouldReloadAfterWorkloadImportFailure,
  } from "../model/workload-lazy-loader";

  interface Props {
    clusterId: string;
    pageData: PageData;
    workloadData: unknown;
  }

  let { clusterId, pageData, workloadData }: Props = $props();
  let renderToken = 0;
  let workloadLoadToken = 0;
  let workloadComponent = $state<any>(null);
  let workloadComponentError = $state<string | null>(null);
  let workloadComponentLoading = $state(false);
  const normalizedWorkloadType = $derived.by(() => {
    const raw = pageData.workload;
    if (typeof raw !== "string") return null;
    const normalized = raw.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  });

  const workloadProps = $derived(createWorkloadProps(normalizedWorkloadType, pageData, workloadData));

  $effect(() => {
    const workloadType = normalizedWorkloadType;
    const loadToken = ++workloadLoadToken;
    workloadComponent = null;
    workloadComponentError = null;
    if (!workloadType) return;
    const loader = workloadComponentLoaders[workloadType];
    if (!loader) {
      workloadComponentError = `Unknown workload type: ${workloadType}`;
      return;
    }
    workloadComponentLoading = true;
    void loader()
      .then((module) => {
        if (loadToken !== workloadLoadToken) return;
        workloadComponent = resolveWorkloadComponentExport(module, workloadType);
      })
      .catch((error) => {
        if (loadToken !== workloadLoadToken) return;
        if (
          typeof window !== "undefined" &&
          isRecoverableWorkloadImportError(error) &&
          shouldReloadAfterWorkloadImportFailure(
            workloadType,
            window.location.pathname,
            window.sessionStorage,
          )
        ) {
          window.location.reload();
          return;
        }
        workloadComponentError =
          error instanceof Error
            ? error.message
            : `Failed to load workload component: ${workloadType}`;
      })
      .finally(() => {
        if (loadToken !== workloadLoadToken) return;
        workloadComponentLoading = false;
      });
  });

  $effect(() => {
    const workloadType = normalizedWorkloadType || "overview";
    const token = ++renderToken;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    void tick().then(() => {
      const run = () => {
        if (token !== renderToken) return;
        const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        trackWorkloadEvent("workloads.view_render_ms", {
          workloadType,
          clusterId,
          durationMs: Math.max(0, Math.round(endedAt - startedAt)),
        });
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 0);
      }
    });
  });

</script>

<div class="workload-display min-w-0">
  {#if workloadComponentError}
    <ErrorMessage error={workloadComponentError} />
  {:else if workloadComponent && workloadProps}
    {#key `${clusterId}:${normalizedWorkloadType ?? "unknown"}`}
      {@const WorkloadComponent = workloadComponent}
      <WorkloadComponent data={{ ...workloadProps, uuid: clusterId }} />
    {/key}
  {:else if workloadComponentLoading}
    <div class="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
      Loading workload panel...
    </div>
  {:else}
    <ErrorMessage error={`Unknown workload type: ${normalizedWorkloadType ?? pageData.workload}`} />
  {/if}
</div>
