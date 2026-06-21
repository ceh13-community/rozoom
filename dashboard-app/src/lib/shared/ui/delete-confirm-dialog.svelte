<script lang="ts">
  import * as Dialog from "$shared/ui/sheet";
  import { Button } from "$shared/ui/button";
  import { Trash } from "$shared/ui/icons";

  export type DeleteTarget = {
    /** kubectl resource kind, e.g. "pod". */
    kind: string;
    name: string;
    namespace: string;
    /** kubectl arguments that will run, without the `kubectl` binary prefix. */
    command: string;
  };

  type DeleteConfirmDialogProps = {
    open: boolean;
    targets: DeleteTarget[];
    onConfirm: () => void;
    onCancel: () => void;
  };

  const { open = false, targets, onConfirm, onCancel }: DeleteConfirmDialogProps = $props();

  const count = $derived(targets.length);
  const kindLabel = $derived(count === 1 ? (targets[0]?.kind ?? "resource") : `${count} resources`);
</script>

<Dialog.Root
  {open}
  onOpenChange={(isOpen) => {
    if (!isOpen) onCancel();
  }}
>
  <Dialog.Content side="bottom" class="sm:max-w-lg sm:rounded-t-xl">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-destructive">
        <Trash class="size-4" />
        Delete {kindLabel}
      </Dialog.Title>
      <Dialog.Description>
        This runs a destructive kubectl command. Review it before confirming.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 px-1 py-3">
      <section class="flex flex-col gap-1.5">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Command to run
        </span>
        <pre
          class="overflow-x-auto rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">{#each targets as target (target.command)}<div>$ kubectl {target.command}</div>{/each}</pre>
      </section>

      <section class="flex flex-col gap-1.5">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Will be removed
        </span>
        <ul
          class="flex flex-col gap-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive"
        >
          {#each targets as target (`${target.namespace}/${target.name}`)}
            <li>
              - {target.kind}/{target.name}
              <span class="text-destructive/70">(namespace: {target.namespace})</span>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <div class="flex justify-end gap-2 pb-2">
      <Button variant="outline" size="sm" onclick={onCancel}>Cancel</Button>
      <Button variant="destructive" size="sm" onclick={onConfirm}>Confirm delete</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
