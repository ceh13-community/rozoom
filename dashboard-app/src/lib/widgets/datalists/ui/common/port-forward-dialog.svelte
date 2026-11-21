<script lang="ts">
  import * as Dialog from "$shared/ui/sheet";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import { defaultLocalPort } from "$shared/lib/port-forward-start-mode";
  import {
    parsePortInput,
    schemeForPort,
    type PortForwardScheme,
    type PortForwardTarget,
  } from "./model/port-forward-target";

  export type PortForwardChoice = {
    remotePort: number;
    localPort: number;
    scheme: PortForwardScheme;
    openWeb: boolean;
  };

  type Props = {
    open: boolean;
    target: PortForwardTarget | null;
    usedLocalPorts: ReadonlySet<number>;
    onConfirm: (choice: PortForwardChoice) => void;
    onCancel: () => void;
  };

  const { open = false, target, usedLocalPorts, onConfirm, onCancel }: Props = $props();

  const OTHER = "other";

  // Replaces the two window.prompt steps (start mode, local port) with one in-app form.
  let selected = $state<string>(OTHER);
  let otherPort = $state<string | number | null>("");
  let localPort = $state<string | number | null>("");
  let localPortEdited = $state(false);
  let openWeb = $state(true);
  let error = $state("");

  const options = $derived(target?.ports ?? []);
  const remotePort = $derived(
    selected === OTHER ? parsePortInput(otherPort) : parsePortInput(selected),
  );

  $effect(() => {
    if (!open || !target) return;
    selected = target.ports[0] ? String(target.ports[0].port) : OTHER;
    otherPort = "";
    localPortEdited = false;
    openWeb = true;
    error = "";
  });

  // The local port follows the remote one until the user types their own.
  $effect(() => {
    if (!open || localPortEdited) return;
    localPort = remotePort ? String(defaultLocalPort(remotePort, usedLocalPorts)) : "";
  });

  function schemeFor(port: number): PortForwardScheme {
    return options.find((option) => option.port === port)?.scheme ?? schemeForPort(port);
  }

  function handleConfirm() {
    if (!remotePort) {
      error = "Enter the remote port, 1-65535.";
      return;
    }
    const local = parsePortInput(localPort);
    if (!local) {
      error = "Enter the local port, 1-65535.";
      return;
    }
    if (usedLocalPorts.has(local)) {
      error = `Local port ${local} is already used by another port-forward.`;
      return;
    }
    error = "";
    onConfirm({ remotePort, localPort: local, scheme: schemeFor(remotePort), openWeb });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleConfirm();
    }
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(isOpen) => {
    if (!isOpen) onCancel();
  }}
>
  <Dialog.Content side="bottom" class="sm:max-w-md sm:rounded-t-xl">
    <Dialog.Header>
      <Dialog.Title>Port-forward</Dialog.Title>
      <Dialog.Description>
        {target
          ? `${target.kind === "service" ? "Service" : "Pod"} ${target.namespace}/${target.name}`
          : ""}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col gap-4 px-1 py-4" data-testid="port-forward-dialog">
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm font-medium">Remote port</legend>
        {#if options.length === 0}
          <p class="text-xs text-muted-foreground">
            No TCP ports are declared in the spec. Enter the port the process listens on.
          </p>
        {/if}
        {#each options as option (option.port)}
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="port-forward-remote"
              value={String(option.port)}
              bind:group={selected}
            />
            <span class="font-mono">{option.port}</span>
            <span class="text-muted-foreground">
              {[option.name, option.container].filter(Boolean).join(" - ")}
            </span>
          </label>
        {/each}
        <label class="flex items-center gap-2 text-sm">
          {#if options.length > 0}
            <input type="radio" name="port-forward-remote" value={OTHER} bind:group={selected} />
            <span>Other</span>
          {/if}
          <Input
            type="number"
            min="1"
            max="65535"
            placeholder="port"
            aria-label="Remote port"
            bind:value={otherPort}
            onfocus={() => (selected = OTHER)}
            onkeydown={handleKeydown}
            class="max-w-[8rem]"
          />
        </label>
      </fieldset>
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium">Local port</span>
        <Input
          type="number"
          min="1"
          max="65535"
          aria-label="Local port"
          bind:value={localPort}
          oninput={() => (localPortEdited = true)}
          onkeydown={handleKeydown}
          class="max-w-[8rem]"
        />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={openWeb} />
        <span>Open the page after it starts</span>
      </label>
      {#if error}
        <p class="text-sm text-destructive" role="alert">{error}</p>
      {/if}
    </div>
    <div class="flex justify-end gap-2 pb-2">
      <Button variant="outline" size="sm" onclick={onCancel}>Cancel</Button>
      <Button size="sm" onclick={handleConfirm}>
        Start{remotePort ? ` ${localPort || "?"}:${remotePort}` : ""}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
