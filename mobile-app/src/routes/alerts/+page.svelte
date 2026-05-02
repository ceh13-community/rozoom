<script lang="ts">
  import { alerts } from "$stores/fleet";
</script>

<div class="screen-header">
  <div>
    <h1>Alerts</h1>
    <div class="subtitle">{$alerts.length} active across fleet</div>
  </div>
</div>

{#each $alerts as alert (alert.id)}
  <div class="card alert-card">
    <div class="alert-icon {alert.severity}">
      {alert.severity === "info" ? "i" : "!"}
    </div>
    <div>
      <div class="alert-title">{alert.title}</div>
      <div class="alert-desc">{alert.description}</div>
      <div class="alert-meta">
        {alert.cluster}{alert.namespace ? ` / ${alert.namespace}` : ""} - {alert.age}
      </div>
    </div>
  </div>
{/each}
