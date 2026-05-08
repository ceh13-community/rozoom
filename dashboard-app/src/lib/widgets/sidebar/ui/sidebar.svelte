<script lang="ts">
  import { onMount } from "svelte";
  import { readTextFile } from "@tauri-apps/plugin-fs";
  import { resourceDir, join } from "@tauri-apps/api/path";
  // Note: readTextFile + resourceDir kept for loadManifest resource fallback
  import { cn } from "$shared";
  import { Button } from "$shared/ui/button";
  import {
    Activity,
    Bell,
    EyeOff,
    Settings,
    ShieldCheck,
    ShieldOff,
    SquareChevronRight,
    MessageSquareCode,
  } from "$shared/ui/icons";
  import { LightSwitch } from "$shared/ui/light-switch";
  import { BUNDLED_TOOLS } from "$shared/config/tooling";
  const appVersion: string = __APP_VERSION__;
  import type { InstallManifest } from "$shared/config/tooling";
  import {
    globalLinterEnabled,
    loadGlobalLinterEnabled,
    saveGlobalLinterEnabled,
  } from "$features/check-health";
  import { stopAllWatchers } from "$features/check-health/model/watchers";
  import {
    showRuntimeDiagnostics,
    loadShowRuntimeDiagnostics,
    saveShowRuntimeDiagnostics,
    showCliNotifications,
    loadShowCliNotifications,
    saveShowCliNotifications,
  } from "$features/check-health/model/runtime-diagnostics-preferences";
  import {
    appNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    dismissAllNotifications,
    formatTimeAgo,
  } from "$shared/lib/app-notifications";
  import * as Popover from "$shared/ui/popover";

  let {
    sidebarOpen,
    gotoPage,
    toggleSidebar,
  }: {
    sidebarOpen: boolean;
    gotoPage: (path: string) => void;
    toggleSidebar: () => void;
  } = $props();

  let toolVersions = $state<Record<string, string | null>>({});
  let linterEnabled = $state(true);
  let diagnosticsEnabled = $state(false);
  let cliNotificationsEnabled = $state(false);
  globalLinterEnabled.subscribe((v) => (linterEnabled = v));
  showRuntimeDiagnostics.subscribe((v) => (diagnosticsEnabled = v));
  showCliNotifications.subscribe((v) => (cliNotificationsEnabled = v));

  function toggleLinter() {
    const next = !linterEnabled;
    void saveGlobalLinterEnabled(next);
    if (!next) stopAllWatchers();
  }

  function toggleDiagnostics() {
    void saveShowRuntimeDiagnostics(!diagnosticsEnabled);
  }

  function toggleCliNotifications() {
    void saveShowCliNotifications(!cliNotificationsEnabled);
  }

  onMount(async () => {
    await loadGlobalLinterEnabled();
    await loadShowRuntimeDiagnostics();
    await loadShowCliNotifications();
    const manifest = await loadManifest();
    const tools = manifest.tools ?? {};
    const versions: Record<string, string | null> = {};
    for (const entry of BUNDLED_TOOLS) {
      versions[entry.tool] = tools[entry.tool]?.version ?? null;
    }
    toolVersions = versions;
  });

  async function loadManifest(): Promise<InstallManifest> {
    try {
      const resp = await fetch("/binaries/install-manifest.json", { cache: "no-store" });
      if (resp.ok) return (await resp.json()) as InstallManifest;
    } catch {
      /* fallback */
    }
    try {
      const base = await resourceDir();
      const manifestPath = await join(base, "binaries", ".install-manifest.json");
      const raw = await readTextFile(manifestPath);
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
</script>

<aside
  class={cn(
    sidebarOpen ? "w-64" : "w-10",
    "app-sidebar-rail fixed top-0 bottom-0 z-40 flex flex-col border-r border-border/60 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 text-slate-100 shadow-2xl transition-all",
  )}
>
  <div class="flex h-full flex-col">
    <nav class="flex-1 space-y-0.5 p-1">
      <Button
        class="w-full p-2 justify-start"
        variant="ghost"
        onclick={() => gotoPage("/cluster-manager")}
        title="Settings"
      >
        <Settings class="h-4 w-4" />
        <span class={cn(sidebarOpen ? "block" : "hidden")}>Settings</span>
      </Button>
      <LightSwitch showLabel={sidebarOpen} />
      <Popover.Root>
        <Popover.Trigger class="w-full">
          <button
            class="flex w-full items-center gap-2 rounded-md p-2 text-sm font-medium text-muted-foreground hover:bg-muted relative"
            title="Notifications"
          >
            <Bell class="h-4 w-4" />
            {#if $unreadCount > 0}
              <span
                class="absolute top-0.5 left-4.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white animate-pulse"
              >
                {$unreadCount > 99 ? "99+" : $unreadCount}
              </span>
            {/if}
            <span class={cn(sidebarOpen ? "block" : "hidden")}>Notifications</span>
          </button>
        </Popover.Trigger>
        <Popover.Content
          class="w-[360px] max-h-[480px] overflow-hidden p-0 flex flex-col"
          side="right"
          sideOffset={8}
        >
          <div class="flex items-center justify-between border-b border-border px-3 py-2 shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold">Notifications</span>
              {#if $unreadCount > 0}
                <span
                  class="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-500"
                >
                  {$unreadCount} new
                </span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              {#if $unreadCount > 0}
                <button
                  class="text-[11px] text-sky-500 hover:text-sky-400"
                  onclick={() => markAllAsRead()}>Mark all read</button
                >
              {/if}
              {#if $appNotifications.length > 0}
                <button
                  class="text-[11px] text-muted-foreground hover:text-foreground"
                  onclick={() => dismissAllNotifications()}>Clear all</button
                >
              {/if}
            </div>
          </div>
          <div class="overflow-y-auto flex-1">
            {#if $appNotifications.length === 0}
              <div class="px-3 py-8 text-center">
                <Bell class="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p class="text-xs text-muted-foreground">No notifications</p>
                <p class="text-[10px] text-muted-foreground/60 mt-1">
                  Certificate alerts will appear here
                </p>
              </div>
            {:else}
              {#each $appNotifications as notif (notif.id)}
                <div
                  class={cn(
                    "flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left transition-colors last:border-0 cursor-pointer",
                    notif.readAt
                      ? "bg-transparent opacity-60 hover:opacity-80"
                      : "bg-sky-500/5 hover:bg-sky-500/10",
                  )}
                  role="button"
                  tabindex="0"
                  onclick={() => markAsRead(notif.id)}
                  onkeydown={(e) => {
                    if (e.key === "Enter") markAsRead(notif.id);
                  }}
                >
                  <span class="mt-1 flex-shrink-0">
                    {#if notif.severity === "critical"}
                      <span
                        class={cn(
                          "inline-block h-2.5 w-2.5 rounded-full bg-rose-500",
                          !notif.readAt && "animate-pulse",
                        )}
                      ></span>
                    {:else if notif.severity === "warning"}
                      <span
                        class={cn(
                          "inline-block h-2.5 w-2.5 rounded-full bg-amber-500",
                          !notif.readAt && "animate-pulse",
                        )}
                      ></span>
                    {:else}
                      <span class="inline-block h-2.5 w-2.5 rounded-full bg-sky-500"></span>
                    {/if}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class={cn("text-xs", notif.readAt ? "font-normal" : "font-semibold")}>
                      {notif.title}
                    </div>
                    {#if notif.detail}
                      <div class="text-[11px] text-muted-foreground mt-0.5">{notif.detail}</div>
                    {/if}
                    <div class="flex items-center gap-2 mt-1">
                      <span class="text-[10px] text-muted-foreground/60">
                        {formatTimeAgo(notif.createdAt)}
                      </span>
                      {#if notif.category === "certificate"}
                        <span
                          class="rounded bg-amber-500/20 px-1 py-px text-[9px] font-medium text-amber-500"
                          >cert</span
                        >
                      {/if}
                      {#if !notif.readAt}
                        <span
                          class="rounded bg-sky-500/20 px-1 py-px text-[9px] font-medium text-sky-400"
                          >new</span
                        >
                      {/if}
                    </div>
                  </div>
                  <button
                    class="flex-shrink-0 mt-1 text-muted-foreground/40 hover:text-foreground text-sm leading-none"
                    onclick={(e) => {
                      e.stopPropagation();
                      dismissNotification(notif.id);
                    }}
                    title="Dismiss">&times;</button
                  >
                </div>
              {/each}
            {/if}
          </div>
        </Popover.Content>
      </Popover.Root>
      <button
        class={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-sm font-medium",
          linterEnabled
            ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
            : "bg-red-600/20 text-red-400 hover:bg-red-600/30",
        )}
        onclick={toggleLinter}
        title={linterEnabled ? "Linter on - click to disable" : "Linter off - click to enable"}
      >
        {#if linterEnabled}
          <ShieldCheck class="h-4 w-4" />
        {:else}
          <ShieldOff class="h-4 w-4 animate-pulse" />
        {/if}
        <span class={cn(sidebarOpen ? "block" : "hidden")}>
          Linter {linterEnabled ? "on" : "off"}
        </span>
      </button>
      <button
        class={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-sm font-medium",
          diagnosticsEnabled
            ? "bg-sky-600/20 text-sky-400 hover:bg-sky-600/30"
            : "bg-slate-600/20 text-slate-400 hover:bg-slate-600/30",
        )}
        onclick={toggleDiagnostics}
        title={diagnosticsEnabled
          ? "Runtime info shown - click to hide"
          : "Runtime info hidden - click to show"}
      >
        {#if diagnosticsEnabled}
          <Activity class="h-4 w-4" />
        {:else}
          <EyeOff class="h-4 w-4" />
        {/if}
        <span class={cn(sidebarOpen ? "block" : "hidden")}>
          Runtime {diagnosticsEnabled ? "on" : "off"}
        </span>
      </button>
      <button
        class={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-sm font-medium",
          cliNotificationsEnabled
            ? "bg-sky-600/20 text-sky-400 hover:bg-sky-600/30"
            : "bg-slate-600/20 text-slate-400 hover:bg-slate-600/30",
        )}
        onclick={toggleCliNotifications}
        title={cliNotificationsEnabled
          ? "CLI toasts shown - click to hide"
          : "CLI toasts hidden - click to show"}
      >
        <MessageSquareCode class={cn("h-4 w-4", !cliNotificationsEnabled && "opacity-50")} />
        <span class={cn(sidebarOpen ? "block" : "hidden")}>
          Toasts {cliNotificationsEnabled ? "on" : "off"}
        </span>
      </button>
    </nav>
    <div
      class={cn(
        "border-t border-white/10 px-2 py-2 text-[11px] text-slate-400",
        sidebarOpen ? "block" : "hidden",
      )}
    >
      <div class="text-[9px] uppercase tracking-[0.35em] text-slate-400">Bundled Tools</div>
      <div class="mt-1 space-y-px text-[10px]">
        {#each BUNDLED_TOOLS as entry (entry.tool)}
          <div class="flex items-center justify-between text-slate-300">
            <span class="text-slate-400">{entry.tool}</span>
            <span class="font-mono text-slate-100">{toolVersions[entry.tool] ?? "-"}</span>
          </div>
        {/each}
      </div>
    </div>
    <div
      class={cn(
        "border-t border-white/10 p-1 flex items-center",
        sidebarOpen ? "justify-between" : "justify-center",
      )}
    >
      <Button variant="ghost" size="icon" title="Toggle sidebar" onclick={toggleSidebar}>
        <SquareChevronRight class="w-4 h-4" />
      </Button>
      <span
        class={cn("font-mono text-[10px] text-slate-500", sidebarOpen ? "pr-2" : "hidden")}
        title="ROZOOM version">v{appVersion}</span
      >
    </div>
  </div>
</aside>
