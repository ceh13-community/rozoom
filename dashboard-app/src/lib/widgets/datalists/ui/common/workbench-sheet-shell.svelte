<script lang="ts">
  import type { Writable } from "svelte/store";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import { Button } from "$shared/ui/button";
  import * as Sheet from "$shared/ui/sheet";

  interface Props {
    embedded?: boolean;
    isOpen: Writable<boolean>;
    title: string;
    collapsedLabel: string;
    standaloneMaxWidthClass?: string;
    canVerticalCollapse?: boolean;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse?: () => void;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    headerActions?: import("svelte").Snippet;
    toolbar?: import("svelte").Snippet;
    children?: import("svelte").Snippet;
  }

  let {
    embedded = false,
    isOpen,
    title,
    collapsedLabel,
    standaloneMaxWidthClass = "sm:max-w-[70vw]",
    canVerticalCollapse = false,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse = () => {},
    isFullscreen = false,
    onToggleFullscreen,
    headerActions,
    toolbar,
    children,
  }: Props = $props();
</script>

{#if embedded}
  <div
    class={`flex flex-col ${
      isFullscreen
        ? "fixed inset-3 z-[170] rounded-lg border bg-background shadow-2xl"
        : "h-full w-full"
    } ${isVerticallyCollapsed ? "max-w-[44px] overflow-hidden" : ""}`}
  >
    {#if isVerticallyCollapsed}
      <div class="flex h-full w-11 flex-col items-center justify-between border-r bg-muted/70 py-2">
        <Button variant="ghost" size="icon" onclick={onToggleVerticalCollapse} title="Expand workloads panel">
          <PanelLeftOpen class="h-4 w-4" />
        </Button>
        <div class="[writing-mode:vertical-rl] rotate-180 text-[11px] tracking-wide text-muted-foreground">
          {collapsedLabel}
        </div>
        <div class="h-9 w-9"></div>
      </div>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div class="text-sm font-medium">{title}</div>
        <div class="flex items-center gap-2">
          {#if headerActions}
            {@render headerActions()}
          {/if}
          {#if canVerticalCollapse}
            <Button variant="outline" size="icon" onclick={onToggleVerticalCollapse} title="Collapse workloads panel">
              <PanelLeftClose class="h-4 w-4" />
            </Button>
          {/if}
          {#if onToggleFullscreen}
            <Button
              variant="outline"
              size="icon"
              onclick={onToggleFullscreen}
              title={isFullscreen ? "Exit full screen" : "Open full screen"}
            >
              {#if isFullscreen}
                <Minimize2 class="h-4 w-4" />
              {:else}
                <Maximize2 class="h-4 w-4" />
              {/if}
            </Button>
          {/if}
        </div>
      </div>
      {#if toolbar}
        <div class="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {@render toolbar()}
        </div>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    {/if}
  </div>
{:else}
  <Sheet.Root bind:open={$isOpen}>
    <Sheet.Content withOverlay={false} class={`flex h-[100dvh] w-full flex-col ${standaloneMaxWidthClass}`}>
      <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div class="text-sm font-medium">{title}</div>
        {#if headerActions}
          <div class="flex items-center gap-2">
            {@render headerActions()}
          </div>
        {/if}
      </div>
      {#if toolbar}
        <div class="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          {@render toolbar()}
        </div>
      {/if}
      {#if children}
        {@render children()}
      {/if}
    </Sheet.Content>
  </Sheet.Root>
{/if}
