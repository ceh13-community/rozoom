<script lang="ts">
  import * as Dialog from "$shared/ui/sheet";
  import { isMac } from "$shared/lib/keyboard-manager";
  import { buildShortcutGroups } from "../model/keyboard-shortcuts";

  type Props = { open: boolean; onClose: () => void };
  const { open = false, onClose }: Props = $props();

  const groups = buildShortcutGroups(isMac());
</script>

<!-- Help > Keyboard Shortcuts: one list of every shortcut, grouped by where it works. -->
<Dialog.Root
  {open}
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Dialog.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Keyboard shortcuts</Dialog.Title>
    </Dialog.Header>
    <div class="space-y-5 px-4 pb-6">
      {#each groups as group (group.title)}
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h3>
          <dl class="space-y-1.5 text-sm">
            {#each group.rows as row (row.keys + row.description)}
              <div class="flex items-center justify-between gap-4">
                <dt class="text-foreground">{row.description}</dt>
                <dd>
                  <kbd
                    class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                    >{row.keys}</kbd
                  >
                </dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
