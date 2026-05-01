<script lang="ts">
  import { page } from "$app/state";
  import { clusters } from "$stores/fleet";

  const cluster = $derived($clusters.find((c) => c.id === page.params.id));
</script>

{#if cluster}
  <a href="/" class="detail-back">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
    Fleet
  </a>

  <div class="screen-header">
    <div>
      <h1>{cluster.name}</h1>
      <div class="subtitle">{cluster.provider} - {cluster.region} - {cluster.cloud}</div>
    </div>
    <span class="pill {cluster.status === 'healthy' ? 'green' : cluster.status === 'warning' ? 'yellow' : 'red'}">
      {cluster.status.charAt(0).toUpperCase() + cluster.status.slice(1)}
    </span>
  </div>

  <div class="detail-hero">
    <div class="big-score {cluster.status}">{cluster.score}</div>
    <div class="score-label">Health Score</div>
  </div>

  <div class="stat-row">
    <div class="stat-box"><div class="val">{cluster.nodes}</div><div class="lbl">Nodes</div></div>
    <div class="stat-box"><div class="val">{cluster.pods}</div><div class="lbl">Pods</div></div>
    <div class="stat-box"><div class="val">{cluster.deploys}</div><div class="lbl">Deploys</div></div>
  </div>

  <div class="stat-row">
    <div class="stat-box"><div class="val" style="color:var(--green)">{cluster.running}</div><div class="lbl">Running</div></div>
    <div class="stat-box"><div class="val" style="color:var(--yellow)">{cluster.pending}</div><div class="lbl">Pending</div></div>
    <div class="stat-box"><div class="val" style="color:var(--red)">{cluster.failed}</div><div class="lbl">Failed</div></div>
  </div>

  <div class="section-title">Workloads</div>
  <div class="card" style="padding: 4px 14px;">
    <div class="workload-row"><div class="workload-dot running"></div><div class="workload-name">api-gateway</div><div class="workload-ready">5/5</div></div>
    <div class="workload-row"><div class="workload-dot running"></div><div class="workload-name">auth-service</div><div class="workload-ready">3/3</div></div>
    <div class="workload-row"><div class="workload-dot pending"></div><div class="workload-name">payment-processor</div><div class="workload-ready">2/3</div></div>
    <div class="workload-row"><div class="workload-dot running"></div><div class="workload-name">notification-svc</div><div class="workload-ready">2/2</div></div>
    <div class="workload-row"><div class="workload-dot failed"></div><div class="workload-name">cronjob-data-sync</div><div class="workload-ready">0/1</div></div>
    <div class="workload-row"><div class="workload-dot running"></div><div class="workload-name">postgres-primary</div><div class="workload-ready">1/1</div></div>
  </div>
{:else}
  <p style="color: var(--text-dim); text-align: center; padding: 48px 0;">Cluster not found</p>
{/if}
