<script lang="ts">
  import * as Dialog from "$shared/ui/sheet";
  import { Button } from "$shared/ui/button";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Github from "@lucide/svelte/icons/github";
  import { openExternalUrl } from "$shared/api/in-app-browser";
  import { CORE_PRINCIPLES, PHILOSOPHY_URL, TEAM_MEMBERS } from "../model/team";

  type Props = { open: boolean; onClose: () => void };
  const { open = false, onClose }: Props = $props();

  // Profile and repository links leave the app: the system browser, never the webview.
  function openLink(url: string) {
    void openExternalUrl(url);
  }
</script>

<!-- Help > About the team: who builds ROZOOM, and the seven principles behind how. -->
<Dialog.Root
  {open}
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Dialog.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>About the team</Dialog.Title>
      <Dialog.Description>The people behind ROZOOM and how we build it.</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-6 px-4 pb-6">
      <section aria-labelledby="about-team-people">
        <h3
          id="about-team-people"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Team
        </h3>
        <ul class="space-y-3 text-sm">
          {#each TEAM_MEMBERS as member (member.name)}
            <li class="flex flex-col gap-1" data-testid="team-member">
              <span class="font-medium text-foreground">{member.name}</span>
              <span class="text-muted-foreground">{member.role}</span>
              {#if member.github || member.linkedin}
                <span class="flex flex-wrap gap-2 pt-0.5">
                  {#if member.github}
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`GitHub profile of ${member.name}`}
                      onclick={() => openLink(member.github ?? "")}
                    >
                      <Github class="h-3.5 w-3.5" />
                      GitHub
                    </Button>
                  {/if}
                  {#if member.linkedin}
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`LinkedIn profile of ${member.name}`}
                      onclick={() => openLink(member.linkedin ?? "")}
                    >
                      <ExternalLink class="h-3.5 w-3.5" />
                      LinkedIn
                    </Button>
                  {/if}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
      <section aria-labelledby="about-team-how">
        <h3
          id="about-team-how"
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          How we build
        </h3>
        <ol class="space-y-2 text-sm">
          {#each CORE_PRINCIPLES as principle, index (principle.title)}
            <li class="flex gap-2" data-testid="core-principle">
              <span class="w-4 shrink-0 text-muted-foreground">{index + 1}.</span>
              <span>
                <span class="font-medium text-foreground">{principle.title}.</span>
                <span class="text-muted-foreground">{principle.line}</span>
              </span>
            </li>
          {/each}
        </ol>
        <Button variant="link" class="mt-3 h-auto px-0" onclick={() => openLink(PHILOSOPHY_URL)}>
          <ExternalLink class="h-3.5 w-3.5" />
          Read the full philosophy
        </Button>
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>
