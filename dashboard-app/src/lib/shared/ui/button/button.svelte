<script lang="ts" module>
  import type { WithElementRef } from "bits-ui";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { type VariantProps, tv } from "tailwind-variants";

  export const buttonVariants = tv({
    base: "focus-visible:ring-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline:
          "border-input bg-background hover:bg-accent hover:text-accent-foreground border shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
      loading?: boolean;
      loadingLabel?: string;
      success?: boolean;
      successLabel?: string;
    };
</script>

<script lang="ts">
  import { cn } from "$shared";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import CheckCircle from "@lucide/svelte/icons/check-circle";

  let {
    class: className,
    variant = "default",
    size = "default",
    ref = $bindable(null),
    href = undefined,
    type = "button",
    disabled = false,
    loading = false,
    loadingLabel = undefined,
    success = false,
    successLabel = undefined,
    children,
    ...restProps
  }: ButtonProps = $props();

  const isActive = $derived(loading || success);
  const stateClass = $derived(
    loading ? "animate-pulse" :
    success ? "ring-2 ring-emerald-400/60" : ""
  );
</script>

{#snippet buttonContent()}
  {#if success && successLabel}
    <CheckCircle class="h-3.5 w-3.5 text-emerald-500" />
    <span>{successLabel}</span>
  {:else if success}
    <CheckCircle class="h-3.5 w-3.5 text-emerald-500" />
    {@render children?.()}
  {:else if loading && loadingLabel}
    <span>{loadingLabel}</span>
    <LoadingDots />
  {:else}
    {@render children?.()}
    {#if loading}
      <LoadingDots />
    {/if}
  {/if}
{/snippet}

{#if href}
  <a
    bind:this={ref}
    class={cn(buttonVariants({ variant, size }), stateClass, className)}
    aria-busy={loading ? "true" : undefined}
    aria-disabled={isActive ? "true" : undefined}
    tabindex={isActive ? -1 : undefined}
    {href}
    {...restProps}
  >
    {@render buttonContent()}
  </a>
{:else}
  <button
    bind:this={ref}
    class={cn(buttonVariants({ variant, size }), stateClass, className)}
    disabled={isActive || disabled}
    aria-busy={loading ? "true" : undefined}
    {type}
    {...restProps}
  >
    {@render buttonContent()}
  </button>
{/if}
