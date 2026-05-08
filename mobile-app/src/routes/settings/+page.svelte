<script lang="ts">
  import { theme, type ThemeId } from "$stores/theme";

  const THEME_LABELS: Record<ThemeId, string> = {
    light: "Light",
    dark: "Dark",
    k9s: "K9s",
  };
</script>

<div class="screen-header">
  <div>
    <h1>Settings</h1>
  </div>
</div>

<div class="section-title">Appearance</div>
<div class="setting-group">
  <button class="setting-item" style="width:100%" onclick={() => theme.cycle()}>
    <span class="setting-label">Theme</span>
    <span class="setting-value">{THEME_LABELS[$theme]}</span>
  </button>
</div>

<div class="section-title">Clusters</div>
<div class="setting-group">
  <div class="setting-item">
    <span class="setting-label">Add Cluster</span>
    <span style="color: var(--text-dim);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </span>
  </div>
  <div class="setting-item">
    <span class="setting-label">Import Kubeconfig</span>
    <span style="color: var(--text-dim);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </span>
  </div>
</div>

<div class="section-title">Preferences</div>
<div class="setting-group">
  <div class="setting-item">
    <span class="setting-label">Refresh Interval</span>
    <span class="setting-value">30s</span>
  </div>
  <div class="setting-item">
    <span class="setting-label">Notifications</span>
    <span class="setting-value">On</span>
  </div>
</div>

<div class="section-title">Connection</div>
<div class="setting-group">
  <div class="setting-item">
    <span class="setting-label">API Timeout</span>
    <span class="setting-value">10s</span>
  </div>
  <div class="setting-item">
    <span class="setting-label">TLS Verification</span>
    <span class="setting-value">On</span>
  </div>
</div>

<div class="section-title">About</div>
<div class="setting-group">
  <div class="setting-item">
    <span class="setting-label">Version</span>
    <span class="setting-value">0.1.0</span>
  </div>
</div>
