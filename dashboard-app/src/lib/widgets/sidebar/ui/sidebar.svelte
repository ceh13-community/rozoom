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
  let cliNotificationsEnabled = $state(true);
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
      <Button class="w-full p-2 justify-start" variant="ghost" title="Notifications">
        <Bell class="h-4 w-4" />
        <span class={cn(sidebarOpen ? "block" : "hidden")}>Notifications</span>
      </Button>
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
        {#if cliNotificationsEnabled}
          <MessageSquareCode class="h-4 w-4" />
        {:else}
          <MessageSquareCode class="h-4 w-4 opacity-50" />
        {/if}
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
