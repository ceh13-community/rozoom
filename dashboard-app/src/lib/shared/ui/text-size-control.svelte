<script lang="ts">
  import {
    UI_ZOOM_DEFAULT,
    UI_ZOOM_MAX,
    UI_ZOOM_MIN,
    changeUiZoom,
    setUiZoom,
    uiZoom,
  } from "$shared/lib/ui-zoom";
  import { isMac } from "$shared/lib/keyboard-manager";

  const percent = $derived(Math.round($uiZoom * 100));
  const shortcutHint = isMac() ? "Cmd + = / - / 0" : "Ctrl + = / - / 0";
</script>

<!-- Interface scale. The same as the zoom shortcuts; the level is kept between launches. -->
<div
  class="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
  title={`Text size: ${shortcutHint}`}
>
  <span class="font-medium">Text size</span>
  <button
    type="button"
    class="h-6 w-6 rounded border border-slate-300 bg-white leading-none hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
    aria-label="Smaller text"
    disabled={$uiZoom <= UI_ZOOM_MIN}
    onclick={() => changeUiZoom(-1)}>-</button
  >
  <span class="w-10 text-center tabular-nums" aria-live="polite">{percent}%</span>
  <button
    type="button"
    class="h-6 w-6 rounded border border-slate-300 bg-white leading-none hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
    aria-label="Larger text"
    disabled={$uiZoom >= UI_ZOOM_MAX}
    onclick={() => changeUiZoom(1)}>+</button
  >
  <button
    type="button"
    class="rounded px-1.5 py-0.5 underline-offset-2 hover:underline disabled:opacity-40"
    disabled={$uiZoom === UI_ZOOM_DEFAULT}
    onclick={() => setUiZoom(UI_ZOOM_DEFAULT)}>Reset</button
  >
</div>
