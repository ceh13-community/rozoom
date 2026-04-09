<script lang="ts">
  import * as Dialog from "$shared/ui/sheet";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";

  type ScaleDialogProps = {
    open: boolean;
    resourceKind: string;
    resourceName: string;
    namespace: string;
    currentReplicas: number;
    onConfirm: (replicas: number) => void;
    onCancel: () => void;
  };

  const {
    open = false,
    resourceKind,
    resourceName,
    namespace,
    currentReplicas,
    onConfirm,
    onCancel,
  }: ScaleDialogProps = $props();

  let inputValue = $state("");
  let error = $state("");

  $effect(() => {
    if (open) {
      inputValue = String(currentReplicas);
      error = "";
    }
  });

  function validate(value: string): number | null {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      error = "Replica count must be a non-negative integer.";
      return null;
    }
    error = "";
    return Number.parseInt(trimmed, 10);
  }

  function handleConfirm() {
    const replicas = validate(inputValue);
    if (replicas === null) return;
    onConfirm(replicas);
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
      <Dialog.Title>Scale {resourceKind}</Dialog.Title>
      <Dialog.Description>
        {namespace}/{resourceName} - currently {currentReplicas} replica{currentReplicas === 1
          ? ""
          : "s"}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col gap-3 px-1 py-4">
      <label for="scale-replicas" class="text-sm font-medium">Desired replica count</label>
      <Input
        id="scale-replicas"
        type="number"
        min="0"
        step="1"
        bind:value={inputValue}
        onkeydown={handleKeydown}
        class="max-w-[12rem]"
      />
      {#if error}
        <p class="text-sm text-destructive">{error}</p>
      {/if}
    </div>
    <div class="flex justify-end gap-2 pb-2">
      <Button variant="outline" size="sm" onclick={onCancel}>Cancel</Button>
      <Button size="sm" onclick={handleConfirm}>
        Scale to {inputValue} replica{inputValue === "1" ? "" : "s"}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
