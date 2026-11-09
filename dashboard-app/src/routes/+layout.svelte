<script lang="ts">
  import { onMount } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import { openInAppUrl } from "$shared/api/in-app-browser";
  import { buildThemeBootstrapScript } from "$shared/theme";
  import { Toaster } from "$shared/ui/sonner";
  import { initCliNotifications } from "$shared/lib/cli-notification";
  import { checkForUpdateSilently } from "$shared/lib/app-updater";
  import {
    startCertNotificationWatcher,
    stopCertNotificationWatcher,
  } from "$features/check-health/model/cert-notification-watcher";
  import { sweepHelmValuesTempfiles } from "$shared/api/helm";
  import { hardenPrivateFiles } from "$shared/lib/private-files";
  import { loadPluginState } from "$shared/plugins";
  import { initAnalytics, trackAppOpened } from "$shared/analytics/wau-c";
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
    // WAU-C telemetry, strictly opt-in. No-ops without a PUBLIC_POSTHOG_KEY or
    // until the user grants consent — see $shared/analytics. Never throws.
    initAnalytics();
    // Activation funnel: app opened. No-ops until consent is granted, so the
    // very first (undecided) launch stays dark; the consent handler fires it
    // with first_run=true once the user opts in.
    void trackAppOpened();
    // The consent prompt is NOT shown here: it appears after the first scan
    // has rendered (cluster cards), so onboarding is never covered by it.
    const cleanupCliNotifications = initCliNotifications();
    startCertNotificationWatcher();
    // Silent update check + background download; the only UI is a bell item
    // once a new build is ready. Never throws, never blocks first paint.
    void checkForUpdateSilently();
    // Best-effort sweep of stale helm-values-*.yaml tempfiles left by crashed
    // installs. Fire-and-forget; never blocks first paint.
    void sweepHelmValuesTempfiles();
    // Kubeconfigs and connection-test copies written by earlier releases kept the
    // umask (664/775); make them owner-only. New files are created that way.
    void hardenPrivateFiles();
    // Hydrate plugin enable/disable state from persisted preferences. Without
    // this, disabledPlugins starts empty on every launch and Marketplace
    // toggles never survive a restart. Fire-and-forget - the sidebar will
    // re-render reactively once the store updates.
    void loadPluginState();
    const handleClick = (event: MouseEvent) => {
      // A component that already handled the click (preventDefault, e.g. the
      // privacy-policy link, which goes to the system browser) must not get a
      // second, in-app window on top of it.
      if (event.defaultPrevented) return;
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
  {@html themeBootstrapMarkup}
</svelte:head>
<ModeWatcher />
<Toaster richColors />

<SplashScreen />
{@render children()}
