<script lang="ts">
  type Props = {
    url: string;
  };

  let { url }: Props = $props();
  let loading = $state(true);
  let iframeUrl = $state("");
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFallbackTimer() {
    if (!fallbackTimer) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function startLoading(nextUrl: string) {
    loading = true;
    iframeUrl = nextUrl;
    clearFallbackTimer();
    fallbackTimer = setTimeout(() => {
      loading = false;
      fallbackTimer = null;
    }, 12_000);
  }

  function handleLoad() {
    loading = false;
    clearFallbackTimer();
  }

  $effect(() => {
    startLoading(url);
    return () => {
      clearFallbackTimer();
    };
  });
</script>

<div class="preview-shell">
  {#if loading}
    <div class="preview-loading" role="status" aria-live="polite">
      <div class="preview-loading-content">
        <span class="preview-spinner"></span>
        <span>Loading web content...</span>
      </div>
    </div>
  {/if}
  <iframe
    title="Web content preview"
    src={iframeUrl}
    referrerpolicy="no-referrer"
    onload={handleLoad}
    class="preview-frame"
  ></iframe>
</div>

<style>
  .preview-shell {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: #0b1220;
  }
  .preview-loading {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at center, #162033 0%, #0b1220 72%);
  }
  .preview-loading-content {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 42, 0.82);
    font-size: 13px;
    color: #e2e8f0;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
  }
  .preview-spinner {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid rgba(148, 163, 184, 0.35);
    border-top-color: #38bdf8;
    animation: preview-spin 0.8s linear infinite;
  }
  .preview-frame {
    border: 0;
    flex: 1;
    width: 100%;
    background: #fff;
  }
  @keyframes preview-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
