<script lang="ts">
  import { onMount } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import { openInAppUrl } from "$shared/api/in-app-browser";
  import { buildThemeBootstrapScript } from "$shared/theme";
  import { Toaster } from "$shared/ui/sonner";
  import { initCliNotifications } from "$shared/lib/cli-notification";
  import {
    startCertNotificationWatcher,
    stopCertNotificationWatcher,
  } from "$features/check-health/model/cert-notification-watcher";
  import { sweepHelmValuesTempfiles } from "$shared/api/helm";
  import { loadPluginState } from "$shared/plugins";
  import SplashScreen from "$shared/ui/splash-screen.svelte";

  import "$lib/app/styles/index.css";

  let { children } = $props();
  const themeBootstrapScript = buildThemeBootstrapScript();
  const scriptOpenTag = "<scr" + "ipt>";
  const scriptCloseTag = "</scr" + "ipt>";
  const escapedScriptCloseTag = "<\\/scr" + "ipt>";
  const themeBootstrapMarkup =
    scriptOpenTag +
    themeBootstrapScript.replaceAll(scriptCloseTag, escapedScriptCloseTag) +
    scriptCloseTag;

  function isExternalHttpUrl(raw: string) {
    return raw.startsWith("http://") || raw.startsWith("https://");
  }

  onMount(() => {
    const cleanupCliNotifications = initCliNotifications();
    startCertNotificationWatcher();
    // Best-effort sweep of stale helm-values-*.yaml tempfiles left by crashed
    // installs. Fire-and-forget; never blocks first paint.
    void sweepHelmValuesTempfiles();
    // Hydrate plugin enable/disable state from persisted preferences. Without
    // this, disabledPlugins starts empty on every launch and Marketplace
    // toggles never survive a restart. Fire-and-forget - the sidebar will
    // re-render reactively once the store updates.
    void loadPluginState();
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href")?.trim() ?? "";
      if (!href || !isExternalHttpUrl(href)) return;
      event.preventDefault();
      void openInAppUrl(href);
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      cleanupCliNotifications();
      stopCertNotificationWatcher();
    };
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" />
  <link
    href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
  <link
    href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
  {@html themeBootstrapMarkup}
</svelte:head>
<ModeWatcher />
<Toaster richColors />

<SplashScreen />
{@render children()}
