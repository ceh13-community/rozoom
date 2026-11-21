<script lang="ts">
  import { hint } from "$shared/lib/hint";
  import { onMount } from "svelte";
  import { Button } from "$shared/ui/button";
  import { Moon, Sun, TerminalSquare } from "$shared/ui/icons";
  import { cn } from "$shared";
  import {
    APP_THEME_LABELS,
    applyTheme,
    getInitialTheme,
    getNextTheme,
    type AppTheme,
  } from "$shared/theme";

  let { showLabel }: { showLabel: boolean } = $props();

  let currentTheme = $state<AppTheme>("dark");

  function cycleTheme() {
    const nextTheme = getNextTheme(currentTheme);
    applyTheme(nextTheme);
    currentTheme = nextTheme;
  }

  onMount(() => {
    const initialTheme = getInitialTheme();
    applyTheme(initialTheme);
    currentTheme = initialTheme;
  });
</script>

<!-- In-app hint: a native title kept the old theme name after the click. -->
<span class="block" use:hint={`Theme: ${APP_THEME_LABELS[currentTheme]}`}>
  <!-- The label is hidden in the collapsed sidebar: the button needs its own name. -->
  <Button
    onclick={cycleTheme}
    variant="ghost"
    class="w-full p-2 justify-start"
    aria-label={`Theme: ${APP_THEME_LABELS[currentTheme]}`}
  >
    {#if currentTheme === "light"}
      <Sun class="h-4 w-4" />
    {:else if currentTheme === "dark"}
      <Moon class="h-4 w-4" />
    {:else}
      <TerminalSquare class="h-4 w-4" />
    {/if}
    <span class={cn(showLabel ? "block" : "hidden", "font-sm")}>
      Theme: {APP_THEME_LABELS[currentTheme]}
    </span>
  </Button>
</span>
