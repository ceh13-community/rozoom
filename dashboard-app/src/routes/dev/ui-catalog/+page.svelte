<script lang="ts">
  import { Button } from "$shared/ui/button";
  import { Badge } from "$shared/ui/badge";
  import { Input } from "$shared/ui/input";
  import { Alert, AlertTitle, AlertDescription } from "$shared/ui/alert";
  import { Skeleton } from "$shared/ui/skeleton";
  import { Checkbox } from "$shared/ui/checkbox";
  import { Separator } from "$shared/ui/separator";
  import * as Card from "$shared/ui/card";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import { Check, Search, Settings, Trash, Info, Refresh, Heart } from "$shared/ui/icons";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import ExternalLink from "@lucide/svelte/icons/external-link";

  let checkboxChecked = $state(false);
  let inputValue = $state("");
  let loadingBtn = $state(false);
  let successBtn = $state(false);

  function simulateLoading() {
    loadingBtn = true;
    setTimeout(() => {
      loadingBtn = false;
      successBtn = true;
      setTimeout(() => {
        successBtn = false;
      }, 2000);
    }, 1500);
  }
</script>

<svelte:head>
  <title>UI Component Catalog - Dev</title>
</svelte:head>

<div class="min-h-screen bg-background p-8">
  <div class="mx-auto max-w-5xl space-y-12">
    <header class="space-y-2">
      <h1 class="text-3xl font-bold text-foreground">UI Component Catalog</h1>
      <p class="text-muted-foreground">
        Shared components from <code class="rounded bg-muted px-1.5 py-0.5 text-sm"
          >$shared/ui/</code
        >. Dev-only page.
      </p>
    </header>

    <Separator />

    <!-- Buttons -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Button</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/button</code>
      </p>

      <div class="space-y-4">
        <h3 class="text-sm font-medium text-muted-foreground">Variants</h3>
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="default">Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>

        <h3 class="text-sm font-medium text-muted-foreground">Sizes</h3>
        <div class="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon"><Settings class="h-4 w-4" /></Button>
        </div>

        <h3 class="text-sm font-medium text-muted-foreground">With icons</h3>
        <div class="flex flex-wrap items-center gap-3">
          <Button><Plus class="h-4 w-4" /> Create</Button>
          <Button variant="outline"><Download class="h-4 w-4" /> Export</Button>
          <Button variant="destructive"><Trash class="h-4 w-4" /> Delete</Button>
          <Button variant="ghost"><Pencil class="h-4 w-4" /> Edit</Button>
          <Button variant="secondary">Open <ExternalLink class="h-4 w-4" /></Button>
        </div>

        <h3 class="text-sm font-medium text-muted-foreground">States</h3>
        <div class="flex flex-wrap items-center gap-3">
          <Button disabled>Disabled</Button>
          <Button
            loading={loadingBtn}
            loadingLabel="Saving"
            success={successBtn}
            successLabel="Saved"
            onclick={simulateLoading}
          >
            Save changes
          </Button>
          <Button loading={true} loadingLabel="Loading">Loading</Button>
          <Button success={true} successLabel="Done">Success</Button>
        </div>
      </div>
    </section>

    <Separator />

    <!-- Badge -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Badge</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/badge</code>
      </p>

      <div class="space-y-4">
        <h3 class="text-sm font-medium text-muted-foreground">Variants</h3>
        <div class="flex flex-wrap items-center gap-3">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>

        <h3 class="text-sm font-medium text-muted-foreground">Semantic examples</h3>
        <div class="flex flex-wrap items-center gap-3">
          <Badge class="bg-emerald-500 text-white border-emerald-600">Running</Badge>
          <Badge class="bg-amber-500 text-black border-amber-600">Pending</Badge>
          <Badge class="bg-rose-600 text-white border-rose-700">Error</Badge>
          <Badge class="bg-slate-500 text-white border-slate-600">Unknown</Badge>
          <Badge class="bg-sky-700 text-white border-sky-800">Info</Badge>
        </div>
      </div>
    </section>

    <Separator />

    <!-- Input -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Input</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/input</code>
      </p>

      <div class="grid max-w-md gap-3">
        <Input placeholder="Default input" bind:value={inputValue} />
        <Input placeholder="Filter pods..." />
        <Input placeholder="Disabled" disabled />
        <div class="relative">
          <Search class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search resources..." class="pl-9" />
        </div>
      </div>
    </section>

    <Separator />

    <!-- Alert -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Alert</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/alert</code>
      </p>

      <div class="max-w-lg space-y-3">
        <Alert>
          <Check class="h-4 w-4" />
          <AlertTitle>Default</AlertTitle>
          <AlertDescription>Everything is working as expected.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertCircle class="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Failed to connect to cluster API server.</AlertDescription>
        </Alert>
      </div>
    </section>

    <Separator />

    <!-- Card -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Card</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/card</code>
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <Card.Root>
          <Card.Header>
            <Card.Title>Cluster Health</Card.Title>
            <Card.Description>Control plane status overview</Card.Description>
          </Card.Header>
          <Card.Content>
            <div class="flex items-center gap-2">
              <Badge class="bg-emerald-500 text-white border-emerald-600">Healthy</Badge>
              <span class="text-sm text-muted-foreground">6/6 checks passed</span>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Node Resources</Card.Title>
            <Card.Description>CPU and memory utilization</Card.Description>
          </Card.Header>
          <Card.Content>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">CPU</span>
                <span>42%</span>
              </div>
              <div class="h-2 rounded-full bg-muted">
                <div class="h-full w-[42%] rounded-full bg-primary"></div>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Memory</span>
                <span>68%</span>
              </div>
              <div class="h-2 rounded-full bg-muted">
                <div class="h-full w-[68%] rounded-full bg-amber-500"></div>
              </div>
            </div>
          </Card.Content>
          <Card.Footer>
            <Button variant="outline" size="sm">View nodes <ChevronRight class="h-4 w-4" /></Button>
          </Card.Footer>
        </Card.Root>
      </div>
    </section>

    <Separator />

    <!-- Checkbox -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Checkbox</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/checkbox</code>
      </p>

      <div class="flex items-center gap-2">
        <Checkbox bind:checked={checkboxChecked} id="demo-checkbox" />
        <label for="demo-checkbox" class="text-sm text-foreground">
          Select all namespaces {checkboxChecked ? "(checked)" : "(unchecked)"}
        </label>
      </div>
    </section>

    <Separator />

    <!-- Skeleton -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Skeleton</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/skeleton</code>
      </p>

      <div class="max-w-md space-y-3">
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-3/4" />
        <Skeleton class="h-4 w-1/2" />
        <div class="flex items-center gap-3">
          <Skeleton class="h-10 w-10 rounded-full" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-4 w-1/3" />
            <Skeleton class="h-3 w-2/3" />
          </div>
        </div>
      </div>
    </section>

    <Separator />

    <!-- LoadingDots -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">LoadingDots</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/loading-dots.svelte</code>
      </p>

      <div class="flex items-center gap-6">
        <span class="text-sm text-muted-foreground">Default (3 dots):</span>
        <LoadingDots />
        <span class="text-sm text-muted-foreground">Custom count (5):</span>
        <LoadingDots count={5} />
      </div>
    </section>

    <Separator />

    <!-- Separator -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Separator</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/separator</code>
      </p>

      <div class="max-w-md space-y-2 text-sm text-muted-foreground">
        <p>Content above separator</p>
        <Separator />
        <p>Content below separator</p>
      </div>
    </section>

    <Separator />

    <!-- Icon reference -->
    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-foreground">Icons</h2>
      <p class="text-sm text-muted-foreground">
        Import: <code class="rounded bg-muted px-1.5 py-0.5">$shared/ui/icons</code> (re-exports from
        @lucide/svelte)
      </p>

      <p class="text-xs text-muted-foreground">
        Registered in <code class="rounded bg-muted px-1">$shared/ui/icons</code> (sample):
      </p>
      <div class="grid grid-cols-6 gap-4 sm:grid-cols-8 md:grid-cols-10">
        {#each [{ icon: Check, name: "Check" }, { icon: Search, name: "Search" }, { icon: Settings, name: "Settings" }, { icon: Trash, name: "Trash" }, { icon: Info, name: "Info" }, { icon: Refresh, name: "Refresh" }, { icon: Heart, name: "Heart" }, { icon: AlertCircle, name: "AlertCircle" }, { icon: Copy, name: "Copy" }, { icon: Download, name: "Download" }, { icon: ExternalLink, name: "ExternalLink" }, { icon: Pencil, name: "Pencil" }, { icon: Plus, name: "Plus" }, { icon: ChevronRight, name: "ChevronRight" }] as item}
          <div
            class="flex flex-col items-center gap-1.5 rounded-md border border-border/60 p-2"
            title={item.name}
          >
            <item.icon class="h-5 w-5 text-foreground" />
            <span class="text-[10px] text-muted-foreground">{item.name}</span>
          </div>
        {/each}
      </div>
    </section>

    <div class="pb-8"></div>
  </div>
</div>
