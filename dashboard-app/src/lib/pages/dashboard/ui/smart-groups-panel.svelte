<script lang="ts">
  import {
    createSmartGroup,
    evaluateSmartGroups,
    type SmartGroup,
    type SmartGroupRule,
  } from "$shared/lib/smart-groups";
  import { loadSmartGroups, saveSmartGroups } from "$shared/lib/smart-groups";
  import { Button } from "$shared/ui/button";
  import type { AppClusterConfig } from "$entities/config";

  interface Props {
    clusters: AppClusterConfig[];
  }

  const { clusters }: Props = $props();

  let smartGroups = $state<SmartGroup[]>([]);
  let editing = $state<{ name: string; rules: SmartGroupRule[]; matchAll: boolean } | null>(null);
  let loaded = $state(false);

  $effect(() => {
    if (!loaded) {
      loaded = true;
      void loadSmartGroups().then((g) => (smartGroups = g));
    }
  });

  const preview = $derived.by(() => {
    if (smartGroups.length === 0) return null;
    return evaluateSmartGroups(clusters, smartGroups);
  });

  function startNew() {
    editing = { name: "", rules: [{ field: "provider", operator: "equals", value: "" }], matchAll: true };
  }

  function addRule() {
    if (!editing) return;
    editing.rules = [...editing.rules, { field: "name", operator: "contains", value: "" }];
  }

  function removeRule(index: number) {
    if (!editing) return;
    editing.rules = editing.rules.filter((_, i) => i !== index);
  }

  async function saveNew() {
    if (!editing || !editing.name.trim() || editing.rules.length === 0) return;
    const validRules = editing.rules.filter((r) => r.value.trim());
    if (validRules.length === 0) return;
    const group = createSmartGroup(editing.name.trim(), validRules, editing.matchAll);
    smartGroups = [...smartGroups, group];
    await saveSmartGroups(smartGroups);
    editing = null;
  }

  async function removeGroup(id: string) {
    smartGroups = smartGroups.filter((g) => g.id !== id);
    await saveSmartGroups(smartGroups);
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-xs space-y-3">
  <div class="flex items-center justify-between">
    <span class="font-medium text-slate-300">Smart Groups (rule-based)</span>
    <button class="text-slate-500 hover:text-emerald-400 transition" onclick={startNew}>+ Add rule</button>
  </div>

  {#if editing}
    <div class="rounded border border-indigo-500/30 bg-indigo-950/20 p-2 space-y-2">
      <input
        type="text"
        bind:value={editing.name}
        placeholder="Group name"
        class="w-full h-6 text-xs px-2 rounded border border-slate-600 bg-slate-900/50 text-slate-200"
      />
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-1 text-[10px] text-slate-400">
          <input type="radio" bind:group={editing.matchAll} value={true} /> Match ALL
        </label>
        <label class="flex items-center gap-1 text-[10px] text-slate-400">
          <input type="radio" bind:group={editing.matchAll} value={false} /> Match ANY
        </label>
      </div>
      {#each editing.rules as rule, i}
        <div class="flex items-center gap-1.5">
          <select bind:value={rule.field} class="h-6 text-[10px] px-1 rounded border border-slate-600 bg-slate-900/50 text-slate-300">
            <option value="provider">Provider</option>
            <option value="env">Environment</option>
            <option value="tags">Tags</option>
            <option value="name">Name</option>
          </select>
          <select bind:value={rule.operator} class="h-6 text-[10px] px-1 rounded border border-slate-600 bg-slate-900/50 text-slate-300">
            <option value="equals">equals</option>
            <option value="contains">contains</option>
            <option value="matches">matches (regex)</option>
          </select>
          <input
            type="text"
            bind:value={rule.value}
            placeholder="value"
            class="flex-1 h-6 text-[10px] px-1.5 rounded border border-slate-600 bg-slate-900/50 text-slate-200"
          />
          <button class="text-slate-500 hover:text-rose-400 text-[10px]" onclick={() => removeRule(i)}>x</button>
        </div>
      {/each}
      <div class="flex gap-1.5">
        <button class="text-[10px] text-slate-500 hover:text-indigo-400" onclick={addRule}>+ Rule</button>
        <Button size="sm" class="text-[10px] h-5 px-2" onclick={saveNew}>Save</Button>
        <button class="text-[10px] text-slate-500 hover:text-slate-300" onclick={() => (editing = null)}>Cancel</button>
      </div>
    </div>
  {/if}

  {#each smartGroups as group (group.id)}
    <div class="flex items-center justify-between gap-2 rounded border border-slate-600 px-2 py-1">
      <div class="min-w-0">
        <span class="text-slate-200">{group.name}</span>
        <span class="text-[10px] text-slate-500 ml-1">({group.rules.length} rules, {group.matchAll ? "ALL" : "ANY"})</span>
        {#if preview}
          {@const match = preview.grouped.find((g) => g.group.id === group.id)}
          {#if match}
            <span class="text-[10px] text-emerald-400 ml-1">{match.clusters.length} clusters</span>
          {:else}
            <span class="text-[10px] text-slate-600 ml-1">0 clusters</span>
          {/if}
        {/if}
      </div>
      <button class="text-slate-500 hover:text-rose-400 text-[10px]" onclick={() => removeGroup(group.id)}>Delete</button>
    </div>
  {/each}
</div>
