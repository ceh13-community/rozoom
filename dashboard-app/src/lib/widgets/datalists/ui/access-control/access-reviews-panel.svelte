<script lang="ts">
  import type { PageData } from "$entities/cluster";
  import { selectedNamespace } from "$features/namespace-management";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import * as Alert from "$shared/ui/alert";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { Input } from "$shared/ui/input";

  interface Props {
    data: PageData & {
      uuid?: string;
    };
  }

  const { data }: Props = $props();

  const clusterId = $derived(data.uuid ?? data.slug ?? "");

  let namespace = $state("default");
  let verb = $state("get");
  let resource = $state("pods");
  let resourceName = $state("");
  let subresource = $state("");
  let asUser = $state("");
  let asGroup = $state("");
  let busy = $state(false);
  let result = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    if ($selectedNamespace && $selectedNamespace !== "all") {
      namespace = $selectedNamespace;
    }
  });

  function buildCanIArgs() {
    const args = ["auth", "can-i", verb.trim(), resource.trim()];
    if (resourceName.trim()) args.push(resourceName.trim());
    if (namespace.trim() && namespace.trim() !== "all") args.push("-n", namespace.trim());
    if (subresource.trim()) args.push("--subresource", subresource.trim());
    if (asUser.trim()) args.push("--as", asUser.trim());
    if (asGroup.trim()) args.push("--as-group", asGroup.trim());
    return args;
  }

  async function runReview() {
    if (!clusterId) {
      errorMessage = "Cluster ID is missing.";
      return;
    }
    if (!verb.trim() || !resource.trim()) {
      errorMessage = "Verb and resource are required.";
      return;
    }

    busy = true;
    errorMessage = null;
    result = null;

    try {
      const response = await kubectlRawArgsFront(buildCanIArgs(), { clusterId });
      if (response.errors) {
        errorMessage = response.errors;
        return;
      }
      result = response.output.trim() || "No output";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Access review failed.";
    } finally {
      busy = false;
    }
  }

  async function copyCommand() {
    const command = `kubectl ${buildCanIArgs().join(" ")}`;
    try {
      await navigator.clipboard.writeText(command);
      result = `Copied: ${command}`;
    } catch {
      errorMessage = "Failed to copy command.";
    }
  }
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <h2 class="text-lg font-semibold">Access Review</h2>
    <p class="text-sm text-muted-foreground">
      Run scoped `kubectl auth can-i` checks for the current cluster and namespace context.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
  {#if errorMessage}
    <Alert.Root variant="destructive">
      <Alert.Title>Error</Alert.Title>
      <Alert.Description>{errorMessage}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if result}
    <Alert.Root>
      <Alert.Title>Result</Alert.Title>
      <Alert.Description>{result}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="grid gap-4 md:grid-cols-2">
    <DiagnosticSummaryCard title="Namespace">
      <p class="text-sm font-semibold text-foreground">{namespace || "default"}</p>
      <p class="text-xs text-muted-foreground">Current scope for `kubectl auth can-i`.</p>
    </DiagnosticSummaryCard>
    <DiagnosticSummaryCard title="Command preview">
      <p class="truncate text-sm font-medium text-foreground" title={`kubectl ${buildCanIArgs().join(" ")}`}>
        kubectl {buildCanIArgs().join(" ")}
      </p>
      <p class="text-xs text-muted-foreground">Updates live as fields change.</p>
    </DiagnosticSummaryCard>
  </div>

  <section class="rounded-lg border border-border/60 bg-background/40 p-4 space-y-3">
    <div class="grid gap-3 md:grid-cols-4">
      <label class="space-y-1 text-xs text-muted-foreground">
        Namespace
        <Input bind:value={namespace} placeholder="default" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Verb
        <Input bind:value={verb} placeholder="get" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Resource
        <Input bind:value={resource} placeholder="pods" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Resource name (optional)
        <Input bind:value={resourceName} placeholder="my-pod" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        Subresource (optional)
        <Input bind:value={subresource} placeholder="log" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        As user (optional)
        <Input bind:value={asUser} placeholder="system:serviceaccount:ns:sa" />
      </label>
      <label class="space-y-1 text-xs text-muted-foreground">
        As group (optional)
        <Input bind:value={asGroup} placeholder="system:authenticated" />
      </label>
    </div>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" onclick={copyCommand}>Copy kubectl</Button>
      <Button type="button" onclick={runReview} loading={busy} loadingLabel="Checking">Can I?</Button>
    </div>
  </section>
  </Card.Content>
</Card.Root>
