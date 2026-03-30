<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { cn } from "$shared";
  import * as Alert from "$shared/ui/alert";
  import { Button } from "$shared/ui/button";

  interface Props {
    title?: string;
    message?: string;
    variant?: "default" | "destructive";
    dismissible?: boolean;
    dismissLabel?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onDismiss?: () => void;
  }

  let {
    title,
    message,
    variant = "default",
    dismissible = false,
    dismissLabel = "Dismiss notification",
    class: className,
    children,
    onDismiss,
  }: Props = $props();
</script>

<Alert.Root class={cn(dismissible && "pr-12", className)} data-variant={variant} {variant}>
  {#if title}
    <Alert.Title>{title}</Alert.Title>
  {/if}
  {#if message || children}
    <Alert.Description>
      {#if message}{message}{/if}
      {#if children}{@render children()}{/if}
    </Alert.Description>
  {/if}

  {#if dismissible}
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="absolute right-2 top-2 h-7 w-7 text-muted-foreground"
      aria-label={dismissLabel}
      onclick={() => onDismiss?.()}
    >
      <X class="size-4" />
    </Button>
  {/if}
</Alert.Root>
