<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    url: string;
  };

  let { url }: Props = $props();

  onMount(() => {
    const target = window.setTimeout(() => {
      window.location.replace(url);
    }, 120);
    return () => {
      window.clearTimeout(target);
    };
  });
</script>

<div class="preview-shell" role="status" aria-live="polite">
  <div class="preview-loading-content">
    <span class="preview-spinner"></span>
    <span>Loading web content...</span>
  </div>
</div>

<style>
  .preview-shell {
    position: fixed;
    inset: 0;
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
  @keyframes preview-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
