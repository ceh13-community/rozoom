<script lang="ts">
  import * as Dialog from "$shared/ui/sheet";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import { Textarea } from "$shared/ui/textarea";
  import { settleTextPrompt, textPrompt } from "$shared/lib/text-prompt.svelte";

  const request = $derived(textPrompt.current);
  let value = $state("");

  // A new request starts from its own initial value.
  $effect.pre(() => {
    value = request?.initialValue ?? "";
  });

  const canConfirm = $derived(Boolean(request?.allowEmpty) || value.trim().length > 0);

  function submit() {
    if (!request || !canConfirm) return;
    settleTextPrompt(value);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !request?.multiline) {
      event.preventDefault();
      submit();
    }
  }
</script>

{#if request}
  <Dialog.Root
    open={true}
    onOpenChange={(isOpen) => {
      if (!isOpen) settleTextPrompt(null);
    }}
  >
    <Dialog.Content side="bottom" class="sm:mx-auto sm:max-w-md sm:rounded-t-xl">
      <Dialog.Header>
        <Dialog.Title>{request.title}</Dialog.Title>
        {#if request.description}
          <Dialog.Description>{request.description}</Dialog.Description>
        {/if}
      </Dialog.Header>
      <div class="px-1 py-4" data-testid="text-prompt">
        {#if request.multiline}
          <Textarea
            bind:value
            aria-label={request.title}
            placeholder={request.placeholder}
            rows={8}
            class="font-mono text-xs"
          />
        {:else}
          <Input
            bind:value
            aria-label={request.title}
            placeholder={request.placeholder}
            onkeydown={handleKeydown}
          />
        {/if}
      </div>
      <div class="flex justify-end gap-2 pb-2">
        <Button variant="outline" size="sm" onclick={() => settleTextPrompt(null)}>Cancel</Button>
        <Button size="sm" disabled={!canConfirm} onclick={submit}>
          {request.confirmLabel ?? "OK"}
        </Button>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}
