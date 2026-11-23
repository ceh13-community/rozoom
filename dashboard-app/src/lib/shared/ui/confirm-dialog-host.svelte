<script lang="ts">
  import { onMount } from "svelte";
  import * as Dialog from "$shared/ui/sheet";
  import { Button } from "$shared/ui/button";
  import {
    confirmDialog,
    registerConfirmHost,
    settleConfirm,
  } from "$shared/lib/confirm-dialog.svelte";

  const request = $derived(confirmDialog.current);
  let cancelButton = $state<HTMLElement | null>(null);
  let confirmButton = $state<HTMLElement | null>(null);

  onMount(() => registerConfirmHost());

  // Focus starts on Cancel. Enter answers only from the button that has focus; anywhere else
  // in the dialog it does nothing, so a stray Enter never confirms. The default action is
  // suppressed so the button's own click does not answer a second time.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.target === confirmButton) settleConfirm(true);
    else if (event.target === cancelButton) settleConfirm(false);
  }
</script>

{#if request}
  {#key request}
    <Dialog.Root
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) settleConfirm(false);
      }}
    >
      <Dialog.Content
        side="bottom"
        class="sm:mx-auto sm:max-w-md sm:rounded-t-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButton?.focus();
        }}
        onkeydown={handleKeydown}
      >
        <Dialog.Header>
          <Dialog.Title>{request.title}</Dialog.Title>
          <Dialog.Description class="whitespace-pre-line">{request.message}</Dialog.Description>
        </Dialog.Header>
        <div class="flex justify-end gap-2 pb-2 pt-4" data-testid="confirm-dialog">
          <Button
            bind:ref={cancelButton}
            variant="outline"
            size="sm"
            onclick={() => settleConfirm(false)}
          >
            Cancel
          </Button>
          <Button
            bind:ref={confirmButton}
            variant="destructive"
            size="sm"
            onclick={() => settleConfirm(true)}
          >
            Confirm
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  {/key}
{/if}
