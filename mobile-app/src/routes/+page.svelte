<script lang="ts">
  import { clusters } from "$stores/fleet";

  let search = $state("");

  const filtered = $derived(
    $clusters.filter(
      (c) =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.provider.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const healthyCount = $derived($clusters.filter((c) => c.status === "healthy").length);
</script>

<div class="screen-header">
  <div>
    <h1>Fleet</h1>
    <div class="subtitle">{$clusters.length} clusters, {healthyCount} healthy</div>
  </div>
</div>

<div class="search-bar">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  <input type="text" placeholder="Search clusters..." bind:value={search} />
</div>

{#each filtered as cluster (cluster.id)}
  <a href="/cluster/{cluster.id}" class="card cluster-card">
    <div class="cluster-status {cluster.status}">{cluster.score}</div>
    <div class="cluster-info">
      <div class="cluster-name">{cluster.name}</div>
      <div class="cluster-provider">{cluster.provider} - {cluster.region} - {cluster.cloud}</div>
      <div class="cluster-metrics">
        <span class="metric"><strong>{cluster.nodes}</strong> nodes</span>
        <span class="metric"><strong>{cluster.pods}</strong> pods</span>
        <span class="metric"><strong>{cluster.deploys}</strong> deploy</span>
      </div>
    </div>
    <div style="color: var(--text-dim); flex-shrink: 0; align-self: center;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  </a>
{/each}

<button class="fab" title="Add cluster">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
</button>
