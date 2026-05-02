export async function openExternalUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[open-external] openUrl rejected:", msg, "url:", url);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:opener|open_url", { path: url });
      console.info("[open-external] fallback invoke succeeded");
      return;
    } catch (invokeErr) {
      console.warn(
        "[open-external] invoke fallback also failed:",
        invokeErr instanceof Error ? invokeErr.message : String(invokeErr),
      );
    }
    if (typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function sanitizeInAppTargetUrl(input: string): string {
  try {
    const parsed = new URL(input);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // noop
  }
  return "about:blank";
}

function buildInAppPreviewUrl(targetUrl: string, redirect = false): string {
  if (typeof window === "undefined") return targetUrl;
  const previewUrl = new URL("/in-app-preview", window.location.origin);
  previewUrl.searchParams.set("url", sanitizeInAppTargetUrl(targetUrl));
  if (redirect) previewUrl.searchParams.set("redirect", "1");
  return previewUrl.toString();
}

export async function openInAppUrl(url: string): Promise<void> {
  const page = buildInAppPreviewUrl(url, true);
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `inapp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const win = new WebviewWindow(label, {
      url: page,
      title: url,
      width: 1320,
      height: 900,
      center: true,
      resizable: true,
      focus: true,
      visible: true,
    });
    void win.once("tauri://error", (e) => {
      console.warn("[open-in-app] WebviewWindow error:", e);
    });
    return;
  } catch (err) {
    console.warn("[open-in-app] WebviewWindow creation failed, falling back to window.open:", err);
    if (typeof window === "undefined") return;
    window.open(page, "_blank", "noopener,noreferrer");
  }
}
